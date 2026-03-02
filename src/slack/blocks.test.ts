import { describe, expect, it } from 'vitest';
import type { ParsedRequest, PipelineState } from '../types/index.js';
import {
  buildConfirmationBlocks,
  buildPipelineCancelledBlocks,
  buildPipelineCompletedBlocks,
  buildPipelineFailedBlocks,
  buildPipelineProgressBlocks,
  buildRecentJobsBlocks,
  buildStatusBlocks,
} from './blocks.js';

function makeParsedRequest(overrides?: Partial<ParsedRequest>): ParsedRequest {
  return {
    type: 'feature',
    title: '새 기능 추가',
    description: '로그인 기능을 추가합니다.',
    targetRepo: 'owner/repo',
    priority: 'medium',
    confidence: 0.85,
    missingInfo: null,
    ...overrides,
  };
}

function makePipelineState(overrides?: Partial<PipelineState>): PipelineState {
  return {
    id: 'job-abc-123',
    threadTs: 'ts123',
    channelId: 'C123',
    userId: 'U123',
    request: makeParsedRequest(),
    status: 'in_progress',
    createdAt: 1700000000000,
    updatedAt: 1700000010000,
    ...overrides,
  };
}

describe('buildConfirmationBlocks', () => {
  it('should include approve action_id with pendingId', () => {
    const parsed = makeParsedRequest();
    const blocks = buildConfirmationBlocks(parsed, 'pending-42');

    const actionsBlock = blocks.find((b) => b.type === 'actions');
    expect(actionsBlock).toBeDefined();

    const actions = (actionsBlock as Extract<(typeof blocks)[number], { type: 'actions' }>)
      .elements;
    const approveBtn = actions.find(
      (el) => 'action_id' in el && el.action_id === 'approve_task:pending-42',
    );
    expect(approveBtn).toBeDefined();
  });

  it('should include reject action_id with pendingId', () => {
    const parsed = makeParsedRequest();
    const blocks = buildConfirmationBlocks(parsed, 'pending-42');

    const actionsBlock = blocks.find((b) => b.type === 'actions');
    const actions = (actionsBlock as Extract<(typeof blocks)[number], { type: 'actions' }>)
      .elements;
    const rejectBtn = actions.find(
      (el) => 'action_id' in el && el.action_id === 'reject_task:pending-42',
    );
    expect(rejectBtn).toBeDefined();
  });

  it('should render type emoji in header section', () => {
    const parsed = makeParsedRequest({ type: 'fix' });
    const blocks = buildConfirmationBlocks(parsed, 'id-1');

    const headerSection = blocks[0];
    expect(headerSection.type).toBe('section');
    const text = (headerSection as Extract<(typeof blocks)[number], { type: 'section' }>).text;
    expect(text?.text).toContain(':bug:');
    expect(text?.text).toContain('새로운 작업 요청');
  });

  it('should include title and targetRepo in fields', () => {
    const parsed = makeParsedRequest({ title: '특별한 기능', targetRepo: 'my-org/my-repo' });
    const blocks = buildConfirmationBlocks(parsed, 'id-2');

    const fieldsBlock = blocks.find(
      (b) => b.type === 'section' && 'fields' in b && b.fields !== undefined,
    ) as Extract<(typeof blocks)[number], { type: 'section' }> & { fields: NonNullable<unknown> };
    expect(fieldsBlock).toBeDefined();

    const allFieldText = JSON.stringify(fieldsBlock.fields);
    expect(allFieldText).toContain('특별한 기능');
    expect(allFieldText).toContain('my-org/my-repo');
  });

  it('should show 미지정 when targetRepo is null', () => {
    const parsed = makeParsedRequest({ targetRepo: null });
    const blocks = buildConfirmationBlocks(parsed, 'id-3');

    const allText = JSON.stringify(blocks);
    expect(allText).toContain('미지정');
  });

  it('should display priority label with emoji', () => {
    const parsed = makeParsedRequest({ priority: 'high' });
    const blocks = buildConfirmationBlocks(parsed, 'id-4');

    const allText = JSON.stringify(blocks);
    expect(allText).toContain(':red_circle:');
    expect(allText).toContain('높음');
  });

  it('should include confidence percentage in context block', () => {
    const parsed = makeParsedRequest({ confidence: 0.92 });
    const blocks = buildConfirmationBlocks(parsed, 'id-5');

    const contextBlock = blocks.find((b) => b.type === 'context');
    expect(contextBlock).toBeDefined();
    const allText = JSON.stringify(contextBlock);
    expect(allText).toContain('92%');
  });

  it('should have approve button with primary style', () => {
    const blocks = buildConfirmationBlocks(makeParsedRequest(), 'id-6');
    const actionsBlock = blocks.find((b) => b.type === 'actions');
    const actions = (actionsBlock as Extract<(typeof blocks)[number], { type: 'actions' }>)
      .elements;
    const approveBtn = actions.find(
      (el) => 'action_id' in el && el.action_id === 'approve_task:id-6',
    ) as {
      style?: string;
    };
    expect(approveBtn?.style).toBe('primary');
  });

  it('should have reject button with danger style', () => {
    const blocks = buildConfirmationBlocks(makeParsedRequest(), 'id-7');
    const actionsBlock = blocks.find((b) => b.type === 'actions');
    const actions = (actionsBlock as Extract<(typeof blocks)[number], { type: 'actions' }>)
      .elements;
    const rejectBtn = actions.find(
      (el) => 'action_id' in el && el.action_id === 'reject_task:id-7',
    ) as {
      style?: string;
    };
    expect(rejectBtn?.style).toBe('danger');
  });
});

describe('buildPipelineProgressBlocks', () => {
  it('should show hourglass for current step', () => {
    const state = makePipelineState({ status: 'in_progress', currentStep: 'clone_repo' });
    const blocks = buildPipelineProgressBlocks(state);

    const sectionText = JSON.stringify(blocks[0]);
    expect(sectionText).toContain(':hourglass_flowing_sand:');
    expect(sectionText).toContain('저장소 클론');
  });

  it('should show checkmark for completed steps', () => {
    const state = makePipelineState({ status: 'in_progress', currentStep: 'clone_repo' });
    const blocks = buildPipelineProgressBlocks(state);

    const sectionText = JSON.stringify(blocks[0]);
    // create_issue comes before clone_repo, so it should be checked
    expect(sectionText).toContain(':white_check_mark:');
    expect(sectionText).toContain('Issue 생성');
  });

  it('should show white circle for not-yet-started steps', () => {
    const state = makePipelineState({ status: 'in_progress', currentStep: 'create_issue' });
    const blocks = buildPipelineProgressBlocks(state);

    const sectionText = JSON.stringify(blocks[0]);
    expect(sectionText).toContain(':white_circle:');
  });

  it('should include cancel button when status is in_progress', () => {
    const state = makePipelineState({ status: 'in_progress', currentStep: 'generate_code' });
    const blocks = buildPipelineProgressBlocks(state);

    const actionsBlock = blocks.find((b) => b.type === 'actions');
    expect(actionsBlock).toBeDefined();
    const allText = JSON.stringify(actionsBlock);
    expect(allText).toContain(`cancel_task:${state.id}`);
  });

  it('should not include cancel button when status is queued', () => {
    const state = makePipelineState({ status: 'queued' });
    const blocks = buildPipelineProgressBlocks(state);

    const actionsBlock = blocks.find((b) => b.type === 'actions');
    expect(actionsBlock).toBeUndefined();
  });

  it('should include confirm dialog on cancel button', () => {
    const state = makePipelineState({ status: 'in_progress', currentStep: 'apply_and_push' });
    const blocks = buildPipelineProgressBlocks(state);

    const actionsBlock = blocks.find((b) => b.type === 'actions');
    const allText = JSON.stringify(actionsBlock);
    expect(allText).toContain('confirm');
    expect(allText).toContain('작업 취소');
  });

  it('should show all white circles when no currentStep is set', () => {
    const state = makePipelineState({ status: 'queued', currentStep: undefined });
    const blocks = buildPipelineProgressBlocks(state);

    const sectionText = JSON.stringify(blocks[0]);
    // all steps should be white circle
    const checkmarkCount = (sectionText.match(/:white_check_mark:/g) ?? []).length;
    expect(checkmarkCount).toBe(0);
    const hourglassCount = (sectionText.match(/:hourglass_flowing_sand:/g) ?? []).length;
    expect(hourglassCount).toBe(0);
  });
});

describe('buildPipelineCompletedBlocks', () => {
  it('should include Issue number', () => {
    const state = makePipelineState({
      status: 'completed',
      issueNumber: 42,
      issueUrl: 'https://github.com/owner/repo/issues/42',
      prNumber: 99,
      prUrl: 'https://github.com/owner/repo/pull/99',
    });
    const blocks = buildPipelineCompletedBlocks(state);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain('Issue #42');
  });

  it('should include PR number', () => {
    const state = makePipelineState({
      status: 'completed',
      issueNumber: 42,
      issueUrl: 'https://github.com/owner/repo/issues/42',
      prNumber: 99,
      prUrl: 'https://github.com/owner/repo/pull/99',
    });
    const blocks = buildPipelineCompletedBlocks(state);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain('PR #99');
  });

  it('should include Issue URL as link', () => {
    const state = makePipelineState({
      status: 'completed',
      issueNumber: 7,
      issueUrl: 'https://github.com/owner/repo/issues/7',
      prNumber: 3,
      prUrl: 'https://github.com/owner/repo/pull/3',
    });
    const blocks = buildPipelineCompletedBlocks(state);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain('https://github.com/owner/repo/issues/7');
  });

  it('should include PR URL as link', () => {
    const state = makePipelineState({
      status: 'completed',
      issueNumber: 7,
      issueUrl: 'https://github.com/owner/repo/issues/7',
      prNumber: 3,
      prUrl: 'https://github.com/owner/repo/pull/3',
    });
    const blocks = buildPipelineCompletedBlocks(state);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain('https://github.com/owner/repo/pull/3');
  });

  it('should show fallback text when issueNumber is missing', () => {
    const state = makePipelineState({ status: 'completed' });
    const blocks = buildPipelineCompletedBlocks(state);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain('Issue 없음');
  });

  it('should show fallback text when prNumber is missing', () => {
    const state = makePipelineState({ status: 'completed' });
    const blocks = buildPipelineCompletedBlocks(state);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain('PR 없음');
  });

  it('should return a section block with completion message', () => {
    const state = makePipelineState({ status: 'completed' });
    const blocks = buildPipelineCompletedBlocks(state);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('section');
    const allText = JSON.stringify(blocks[0]);
    expect(allText).toContain('완료');
  });
});

describe('buildPipelineFailedBlocks', () => {
  it('should include error message in text', () => {
    const state = makePipelineState({
      status: 'failed',
      error: 'GitHub API 호출 실패: 401 Unauthorized',
    });
    const blocks = buildPipelineFailedBlocks(state);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain('GitHub API 호출 실패: 401 Unauthorized');
  });

  it('should show fallback error text when error is undefined', () => {
    const state = makePipelineState({ status: 'failed', error: undefined });
    const blocks = buildPipelineFailedBlocks(state);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain('알 수 없는 오류');
  });

  it('should return a section block with failure indicator', () => {
    const state = makePipelineState({ status: 'failed', error: '타임아웃' });
    const blocks = buildPipelineFailedBlocks(state);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('section');
    const allText = JSON.stringify(blocks[0]);
    expect(allText).toContain(':x:');
  });
});

describe('buildPipelineCancelledBlocks', () => {
  it('should show cancelled user with Slack mention', () => {
    const state = makePipelineState({
      status: 'cancelled',
      cancelledBy: 'U999',
      cancelledAt: Date.now(),
    });
    const blocks = buildPipelineCancelledBlocks(state);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain('<@U999>');
  });

  it('should show fallback when cancelledBy is undefined', () => {
    const state = makePipelineState({ status: 'cancelled', cancelledBy: undefined });
    const blocks = buildPipelineCancelledBlocks(state);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain('알 수 없음');
  });

  it('should return a section block with cancellation message', () => {
    const state = makePipelineState({ status: 'cancelled', cancelledBy: 'U001' });
    const blocks = buildPipelineCancelledBlocks(state);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('section');
    const allText = JSON.stringify(blocks[0]);
    expect(allText).toContain('취소');
  });
});

describe('buildStatusBlocks', () => {
  it('should include metadata context block', () => {
    const state = makePipelineState({ status: 'in_progress', currentStep: 'create_issue' });
    const blocks = buildStatusBlocks(state);

    const contextBlock = blocks.find((b) => b.type === 'context');
    expect(contextBlock).toBeDefined();
    const allText = JSON.stringify(contextBlock);
    expect(allText).toContain('job-abc-123');
  });

  it('should return completed blocks for completed status', () => {
    const state = makePipelineState({
      status: 'completed',
      issueNumber: 1,
      issueUrl: 'https://github.com/x/y/issues/1',
      prNumber: 2,
      prUrl: 'https://github.com/x/y/pull/2',
    });
    const blocks = buildStatusBlocks(state);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain('완료');
    expect(allText).toContain('Issue #1');
    expect(allText).toContain('PR #2');
  });

  it('should return failed blocks for failed status', () => {
    const state = makePipelineState({ status: 'failed', error: '연결 오류' });
    const blocks = buildStatusBlocks(state);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain(':x:');
    expect(allText).toContain('연결 오류');
  });

  it('should return cancelled blocks for cancelled status', () => {
    const state = makePipelineState({ status: 'cancelled', cancelledBy: 'U777' });
    const blocks = buildStatusBlocks(state);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain('<@U777>');
    expect(allText).toContain('취소');
  });

  it('should return progress blocks for in_progress status', () => {
    const state = makePipelineState({ status: 'in_progress', currentStep: 'generate_code' });
    const blocks = buildStatusBlocks(state);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain(':hourglass_flowing_sand:');
    expect(allText).toContain('코드 생성');
  });

  it('should return progress blocks for queued status', () => {
    const state = makePipelineState({ status: 'queued' });
    const blocks = buildStatusBlocks(state);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain(':white_circle:');
  });

  it('should include createdAt in metadata', () => {
    const state = makePipelineState({ status: 'in_progress', currentStep: 'create_issue' });
    const blocks = buildStatusBlocks(state);

    const contextBlock = blocks.find((b) => b.type === 'context');
    const allText = JSON.stringify(contextBlock);
    // createdAt 1700000000000 -> unix 1700000000
    expect(allText).toContain('1700000000');
  });
});

describe('buildRecentJobsBlocks', () => {
  it('should list each job as a line with status emoji and title', () => {
    const states: PipelineState[] = [
      makePipelineState({
        id: 'job-1',
        status: 'completed',
        request: makeParsedRequest({ title: '로그인 기능' }),
      }),
      makePipelineState({
        id: 'job-2',
        status: 'failed',
        request: makeParsedRequest({ title: '버그 수정' }),
      }),
      makePipelineState({
        id: 'job-3',
        status: 'in_progress',
        request: makeParsedRequest({ title: '리팩터링' }),
      }),
    ];
    const blocks = buildRecentJobsBlocks(states);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain('로그인 기능');
    expect(allText).toContain('버그 수정');
    expect(allText).toContain('리팩터링');
  });

  it('should include job IDs', () => {
    const states: PipelineState[] = [makePipelineState({ id: 'job-xyz', status: 'completed' })];
    const blocks = buildRecentJobsBlocks(states);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain('job-xyz');
  });

  it('should include status emoji for completed', () => {
    const states: PipelineState[] = [makePipelineState({ id: 'job-1', status: 'completed' })];
    const blocks = buildRecentJobsBlocks(states);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain(':white_check_mark:');
  });

  it('should include status emoji for failed', () => {
    const states: PipelineState[] = [makePipelineState({ id: 'job-2', status: 'failed' })];
    const blocks = buildRecentJobsBlocks(states);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain(':x:');
  });

  it('should include status emoji for in_progress', () => {
    const states: PipelineState[] = [makePipelineState({ id: 'job-3', status: 'in_progress' })];
    const blocks = buildRecentJobsBlocks(states);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain(':gear:');
  });

  it('should show empty state message when given an empty array', () => {
    const blocks = buildRecentJobsBlocks([]);

    expect(blocks).toHaveLength(1);
    const allText = JSON.stringify(blocks);
    expect(allText).toContain('최근 작업이 없습니다');
  });

  it('should handle mixed statuses correctly', () => {
    const states: PipelineState[] = [
      makePipelineState({ id: 'j1', status: 'cancelled', cancelledBy: 'U1' }),
      makePipelineState({ id: 'j2', status: 'queued' }),
      makePipelineState({ id: 'j3', status: 'pending_confirmation' }),
    ];
    const blocks = buildRecentJobsBlocks(states);

    const allText = JSON.stringify(blocks);
    expect(allText).toContain(':no_entry_sign:');
    expect(allText).toContain(':inbox_tray:');
    expect(allText).toContain(':hourglass:');
  });
});
