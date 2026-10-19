// eslint-disable-next-line import/no-cycle
import { openScheduleModal } from '../../scripts/schedule-modal.js';

// Ties count as positive (e.g. 2-of-4 is positive).
const isPositive = (yesCount, total) => 2 * yesCount >= total;

function buildToggle(index, preselect) {
  const group = document.createElement('div');
  group.className = 'assessment-toggle';
  group.setAttribute('role', 'radiogroup');
  ['Yes', 'No'].forEach((label) => {
    const value = label.toLowerCase();
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `assessment-q${index}`;
    input.id = `assessment-q${index}-${value}`;
    input.value = value;
    input.checked = preselect && value === 'yes';
    const lbl = document.createElement('label');
    lbl.className = 'assessment-option';
    lbl.setAttribute('for', input.id);
    lbl.textContent = label;
    group.append(input, lbl);
  });
  return group;
}

export default function decorate(block) {
  const rows = [...block.children];
  if (rows.length < 3) return;

  // ies variant: no default answer, progress bar, result shown once every question is answered
  const ies = block.classList.contains('ies');

  const introCell = rows[0].firstElementChild;
  const resultCells = [...rows[rows.length - 1].children];
  const questionRows = rows.slice(1, -1);

  const intro = document.createElement('div');
  intro.className = 'assessment-intro';
  intro.append(...introCell.childNodes);

  const questions = document.createElement('div');
  questions.className = 'assessment-questions';
  const toggles = questionRows.map((row, i) => {
    const item = document.createElement('div');
    item.className = 'assessment-question';
    const text = document.createElement('p');
    text.className = 'assessment-question-text';
    text.textContent = row.firstElementChild.textContent.trim();
    const toggle = buildToggle(i, !ies);
    toggle.setAttribute('aria-label', text.textContent);
    item.append(text, toggle);
    questions.append(item);
    return toggle;
  });

  const result = document.createElement('div');
  result.className = 'assessment-result';
  const messages = [...(resultCells[0]?.querySelectorAll('p') || [])];
  const positiveMsg = messages[0]?.textContent.trim() || '';
  const negativeMsg = messages[1]?.textContent.trim() || positiveMsg;
  const message = document.createElement('p');
  message.className = 'assessment-message';
  const cta = resultCells[1]?.querySelector('a');
  if (cta) cta.classList.add('button', 'primary', 'assessment-cta');
  result.append(message);
  if (cta) result.append(cta);

  let progress;
  let progressLabel;
  let progressBar;
  if (ies) {
    progress = document.createElement('div');
    progress.className = 'assessment-progress';
    progressLabel = document.createElement('p');
    progressLabel.className = 'assessment-progress-label';
    progressLabel.setAttribute('aria-live', 'polite');
    const track = document.createElement('div');
    track.className = 'assessment-progress-track';
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', 'Questions answered');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(toggles.length));
    progressBar = document.createElement('div');
    progressBar.className = 'assessment-progress-bar';
    track.append(progressBar);
    progress.append(progressLabel, track);
  }

  const update = () => {
    if (ies) {
      const answered = toggles.filter((t) => t.querySelector('input:checked')).length;
      progressLabel.textContent = `${answered} of ${toggles.length} answered`;
      progressBar.parentElement.setAttribute('aria-valuenow', String(answered));
      progressBar.style.width = `${(answered / toggles.length) * 100}%`;
      result.hidden = answered < toggles.length;
    }
    const yesCount = toggles.filter((t) => t.querySelector('input:checked')?.value === 'yes').length;
    const positive = isPositive(yesCount, toggles.length);
    message.textContent = positive ? positiveMsg : negativeMsg;
    if (cta) cta.setAttribute('aria-disabled', positive ? 'false' : 'true');
  };

  toggles.forEach((t) => t.addEventListener('change', update));
  if (cta) {
    cta.addEventListener('click', (e) => {
      e.preventDefault();
      if (cta.getAttribute('aria-disabled') !== 'true') openScheduleModal();
    });
  }

  const panel = document.createElement('div');
  panel.className = 'assessment-panel';
  const main = document.createElement('div');
  main.className = 'assessment-main';
  if (progress) main.append(progress);
  main.append(questions, result);
  panel.append(intro, main);
  block.replaceChildren(panel);
  update();
}
