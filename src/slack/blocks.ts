import type { KnownBlock } from '@slack/types';
import type { ParsedRequest, PipelineState, PipelineStep } from '../types/index.js';

const typeEmoji: Record<ParsedRequest['type'], string> = {
  feature: ':sparkles:',
  fix: ':bug:',
  refactor: ':recycle:',
  docs: ':books:',
  test: ':test_tube:',
};

const priorityLabel: Record<ParsedRequest['priority'], string> = {
  high: ':red_circle: 높음',
  medium: ':large_yellow_circle: 보통',
  low: ':large_green_circle: 낮음',
};

const statusEmoji: Record<PipelineState['status'], string> = {
  pending_confirmation: ':hourglass:',
  queued: ':inbox_tray:',
  in_progress: ':gear:',
  completed: ':white_check_mark:',
  failed: ':x:',
  cancelled: ':no_entry_sign:',
};

const PIPELINE_STEPS: { name: PipelineStep; label: string }[] = [
  { name: 'create_notion_issue', label: 'Notion Issue 생성' },
  { name: 'create_issue', label: 'GitHub Issue 생성' },
  { name: 'clone_repo', label: '저장소 클론' },
  { name: 'generate_code', label: '코드 생성' },
  { name: 'apply_and_push', label: '커밋 & 푸시' },
  { name: 'create_pr', label: 'PR 생성' },
];

export function buildConfirmationBlocks(parsed: ParsedRequest, pendingId: string): KnownBlock[] {
  const emoji = typeEmoji[parsed.type];
  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *새로운 작업 요청*`,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*유형*\n${parsed.type}`,
        },
        {
          type: 'mrkdwn',
          text: `*우선순위*\n${priorityLabel[parsed.priority]}`,
        },
        {
          type: 'mrkdwn',
          text: `*제목*\n${parsed.title}`,
        },
        {
          type: 'mrkdwn',
          text: `*대상 저장소*\n${parsed.targetRepo ?? '미지정'}`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*설명*\n${parsed.description}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '승인', emoji: true },
          style: 'primary',
          action_id: `approve_task:${pendingId}`,
          value: pendingId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '거부', emoji: true },
          style: 'danger',
          action_id: `reject_task:${pendingId}`,
          value: pendingId,
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `신뢰도: ${Math.round(parsed.confidence * 100)}%`,
        },
      ],
    },
  ];

  return blocks;
}

export function buildPipelineProgressBlocks(state: PipelineState): KnownBlock[] {
  const stepOrder = PIPELINE_STEPS.map((s) => s.name);
  const currentIndex = state.currentStep !== undefined ? stepOrder.indexOf(state.currentStep) : -1;

  const checklist = PIPELINE_STEPS.map((step, index) => {
    let icon: string;
    if (index < currentIndex) {
      icon = ':white_check_mark:';
    } else if (index === currentIndex) {
      icon = ':hourglass_flowing_sand:';
    } else {
      icon = ':white_circle:';
    }
    return `${icon} ${step.label}`;
  }).join('\n');

  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: checklist,
      },
    },
  ];

  if (state.status === 'in_progress') {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '취소', emoji: true },
          style: 'danger',
          action_id: `cancel_task:${state.id}`,
          value: state.id,
          confirm: {
            title: { type: 'plain_text', text: '작업 취소' },
            text: { type: 'mrkdwn', text: '정말 이 작업을 취소하시겠습니까?' },
            confirm: { type: 'plain_text', text: '취소' },
            deny: { type: 'plain_text', text: '돌아가기' },
          },
        },
      ],
    });
  }

  return blocks;
}

export function buildPipelineCompletedBlocks(state: PipelineState): KnownBlock[] {
  const issuePart =
    state.issueNumber !== undefined && state.issueUrl
      ? `<${state.issueUrl}|Issue #${state.issueNumber}>`
      : state.issueNumber !== undefined
        ? `Issue #${state.issueNumber}`
        : 'Issue 없음';

  const prPart =
    state.prNumber !== undefined && state.prUrl
      ? `<${state.prUrl}|PR #${state.prNumber}>`
      : state.prNumber !== undefined
        ? `PR #${state.prNumber}`
        : 'PR 없음';

  const notionPart = state.notionPageUrl
    ? `\n:notebook_with_decorative_cover: <${state.notionPageUrl}|Notion>`
    : '';

  let timingsText = '';
  if (state.stepTimings) {
    const entries = Object.entries(state.stepTimings);
    const totalMs = entries.reduce((sum, [, ms]) => sum + ms, 0);
    const lines = entries.map(([step, ms]) => `  ${step}: ${(ms / 1000).toFixed(1)}s`);
    lines.push(`  *총 소요 시간: ${(totalMs / 1000).toFixed(1)}s*`);
    timingsText = `\n\n:stopwatch: *소요 시간*\n${lines.join('\n')}`;
  }

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:white_check_mark: *작업이 완료되었습니다!*\n\n:ticket: ${issuePart}\n:merged: ${prPart}${notionPart}\n\nPR을 리뷰하고 머지해주세요!${timingsText}`,
      },
    },
  ];
}

export function buildPipelineFailedBlocks(state: PipelineState): KnownBlock[] {
  const errorMessage = state.error ?? '알 수 없는 오류';
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:x: *작업이 실패했습니다.*\n\n오류: ${errorMessage}`,
      },
    },
  ];
}

export function buildPipelineCancelledBlocks(state: PipelineState): KnownBlock[] {
  const cancelledByText = state.cancelledBy ? `<@${state.cancelledBy}>` : '알 수 없음';
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:no_entry_sign: *작업이 취소되었습니다.*\n\n취소한 사용자: ${cancelledByText}`,
      },
    },
  ];
}

export function buildStatusBlocks(state: PipelineState): KnownBlock[] {
  let contentBlocks: KnownBlock[];

  switch (state.status) {
    case 'completed':
      contentBlocks = buildPipelineCompletedBlocks(state);
      break;
    case 'failed':
      contentBlocks = buildPipelineFailedBlocks(state);
      break;
    case 'cancelled':
      contentBlocks = buildPipelineCancelledBlocks(state);
      break;
    case 'in_progress':
    case 'queued':
      contentBlocks = buildPipelineProgressBlocks(state);
      break;
    default:
      contentBlocks = buildPipelineProgressBlocks(state);
      break;
  }

  const metaBlock: KnownBlock = {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Job ID: \`${state.id}\` | 생성: <!date^${Math.floor(state.createdAt / 1000)}^{date_short_pretty} {time}|${new Date(state.createdAt).toISOString()}>`,
      },
    ],
  };

  return [...contentBlocks, metaBlock];
}

export function buildRecentJobsBlocks(states: PipelineState[]): KnownBlock[] {
  if (states.length === 0) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '최근 작업이 없습니다.',
        },
      },
    ];
  }

  const lines = states.map((s) => {
    const emoji = statusEmoji[s.status];
    return `${emoji} *${s.request.title}* — \`${s.id}\``;
  });

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: lines.join('\n'),
      },
    },
  ];
}
