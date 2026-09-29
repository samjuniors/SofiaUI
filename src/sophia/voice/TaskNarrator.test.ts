import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  taskNarrator,
  setTaskAnnouncer,
  isAwaitingTaskApproval,
  pastTense,
  presentTense,
  type NarrationKind,
} from './TaskNarrator.ts';
import { taskEvents } from '../../core/TaskLoop.ts';

void taskNarrator;

function emit(detail: Record<string, unknown>) {
  taskEvents.dispatchEvent(new CustomEvent('task:state', { detail: { id: 't', ...detail } }));
}

function narrated(fn: () => void): Array<{ line: string; kind: NarrationKind }> {
  const lines: Array<{ line: string; kind: NarrationKind }> = [];
  setTaskAnnouncer((line, kind) => lines.push({ line, kind }));
  try {
    fn();
  } finally {
    setTaskAnnouncer(null);
  }
  return lines;
}

test('tense helpers turn step labels into speech', () => {
  assert.equal(pastTense('open_app Excel'), 'opened Excel');
  assert.equal(presentTense('type_text'), 'typing now');
  assert.equal(pastTense('click e5'), 'clicked');
  assert.equal(presentTense('hotkey win'), 'pressing win');
  assert.equal(pastTense('Hit play'), 'Hit play', 'free-text notes pass through');
});

test('steps narrate as "did X, doing Y" — one line per step', () => {
  const lines = narrated(() => {
    emit({ phase: 'started', goal: 'g' });
    emit({ phase: 'decided', index: 0, label: 'open_app Excel' });
    emit({ phase: 'step', index: 0 });
    emit({ phase: 'verified', index: 0, pass: true });
    emit({ phase: 'decided', index: 1, label: 'type_text' });
    emit({ phase: 'step', index: 1 });
    emit({ phase: 'verified', index: 1, pass: true });
  });
  assert.deepEqual(lines, [
    { line: 'Opening Excel.', kind: 'progress' },
    { line: 'opened Excel, typing now.', kind: 'progress' },
  ]);
});

test('only the first consecutive retry gets a hint', () => {
  const lines = narrated(() => {
    emit({ phase: 'started', goal: 'g' });
    emit({ phase: 'retry', reason: 'miss' });
    emit({ phase: 'retry', reason: 'miss again' });
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0].line, /trying a different way/);
});

test('pauses voice the question and arm voice approval; terminal states announce', () => {
  assert.equal(isAwaitingTaskApproval(), false);
  const lines = narrated(() => {
    emit({ phase: 'started', goal: 'g' });
    emit({ phase: 'paused', question: 'Excel wants to save changes. Allow it?' });
    assert.equal(isAwaitingTaskApproval(), true);
    emit({ phase: 'decided', index: 2, label: 'click e1' });
    assert.equal(isAwaitingTaskApproval(), false, 'resuming clears the flag');
    emit({ phase: 'done', summary: 'Done "g" — 2/2 steps verified. All good. Extra sentence here.' });
  });
  assert.deepEqual(lines, [
    { line: 'Excel wants to save changes. Allow it? Say approve or deny.', kind: 'approval' },
    { line: 'Done — Done "g" — 2/2 steps verified.', kind: 'result' },
  ]);
});

test('failed and cancelled tasks announce briefly', () => {
  const lines = narrated(() => {
    emit({ phase: 'started', goal: 'g' });
    emit({ phase: 'failed', summary: 'Failed "g" — screen unchanged.' });
    emit({ phase: 'started', goal: 'g2' });
    emit({ phase: 'cancelled' });
  });
  assert.deepEqual(lines, [
    { line: 'That failed — Failed "g" — screen unchanged.', kind: 'result' },
    { line: 'Stopped.', kind: 'result' },
  ]);
});

test('silent with no announcer', () => {
  setTaskAnnouncer(null);
  emit({ phase: 'started', goal: 'g' });
  emit({ phase: 'done', summary: 'Done.' });
});

test('barge-in cancel and approval matchers stay narrow', async () => {
  const { matchTaskCancelUtterance, matchApprovalAnswer } = await import('./TaskNarrator.ts');
  for (const t of ['stop', 'stop.', 'cancel', 'never mind', 'forget it', 'hold on', 'wait', 'wait stop']) {
    assert.equal(matchTaskCancelUtterance(t), true, t);
  }
  for (const t of ['stop moving', 'cancel the meeting notes', 'waiting for it', 'please stop by later']) {
    assert.equal(matchTaskCancelUtterance(t), false, t);
  }
  assert.equal(matchApprovalAnswer('yes'), 'approve');
  assert.equal(matchApprovalAnswer('go ahead'), 'approve');
  assert.equal(matchApprovalAnswer('no'), 'deny');
  assert.equal(matchApprovalAnswer("don't"), 'deny');
  assert.equal(matchApprovalAnswer('maybe later'), null);
});
