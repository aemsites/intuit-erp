// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
// eslint-disable-next-line import/no-unresolved
import { DA_ORIGIN } from 'https://da.live/nx/public/utils/constants.js';

async function fetchTaggingData(actions, org, repo) {
  try {
    const url = `${DA_ORIGIN}/source/${org}/${repo}/docs/library/tagging.json`;
    const response = await actions.daFetch(url);
    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.error(`Failed to fetch tagging data: ${response.status} ${response.statusText}`);
      return null;
    }
    return response.json();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error fetching tagging data:', error);
    return null;
  }
}

function showMessage(parent, className, text) {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  parent.appendChild(el);
}

function displayTaggingData(taggingData, actions) {
  if (!taggingData) {
    showMessage(document.body, 'error-message', 'Failed to load tagging data');
    return;
  }

  const container = document.createElement('div');
  container.className = 'tags-container';

  if (!taggingData.data || !Array.isArray(taggingData.data)) {
    showMessage(container, 'warning-message', 'No tagging data found');
    document.body.appendChild(container);
    return;
  }

  const searchContainer = document.createElement('div');
  searchContainer.className = 'search-container';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search tags...';
  searchInput.className = 'search-input';
  searchInput.setAttribute('aria-label', 'Search tags');
  searchContainer.appendChild(searchInput);
  container.appendChild(searchContainer);

  const resultsContainer = document.createElement('div');
  resultsContainer.className = 'results-container';
  resultsContainer.setAttribute('role', 'list');
  container.appendChild(resultsContainer);

  const selectedTags = new Set();

  const selectAllBtn = document.createElement('button');
  selectAllBtn.textContent = 'Select All';
  selectAllBtn.className = 'btn btn-secondary';

  const deselectAllBtn = document.createElement('button');
  deselectAllBtn.textContent = 'Deselect All';
  deselectAllBtn.className = 'btn btn-secondary';

  const sendBtn = document.createElement('button');
  sendBtn.className = 'btn btn-primary';
  sendBtn.disabled = true;

  function updateSendButton() {
    const count = selectedTags.size;
    sendBtn.textContent = `Add Selected (${count})`;
    sendBtn.disabled = count === 0;
    sendBtn.className = count > 0 ? 'btn btn-primary' : 'btn btn-secondary';
  }

  updateSendButton();

  function renderTagList(items) {
    resultsContainer.innerHTML = '';

    if (items.length === 0) {
      const noResults = document.createElement('div');
      noResults.className = 'no-results';
      noResults.textContent = 'No tags found matching your search';
      resultsContainer.appendChild(noResults);
      return;
    }

    items.forEach((item) => {
      if (!item.value) return;

      const tagItem = document.createElement('div');
      tagItem.className = 'tag-item';
      tagItem.setAttribute('role', 'listitem');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'tag-checkbox';
      checkbox.checked = selectedTags.has(item.key);
      checkbox.setAttribute('aria-label', item.value);

      checkbox.addEventListener('change', (e) => {
        if (e.target.checked) {
          selectedTags.add(item.key);
        } else {
          selectedTags.delete(item.key);
        }
        updateSendButton();
      });

      const tagInfo = document.createElement('div');
      tagInfo.className = 'tag-info';

      const tagValue = document.createElement('div');
      tagValue.textContent = item.value;
      tagValue.className = 'tag-value';

      const tagKey = document.createElement('div');
      tagKey.textContent = item.key;
      tagKey.className = 'tag-key';

      tagInfo.appendChild(tagValue);
      tagInfo.appendChild(tagKey);

      if (item.comments) {
        const tagComments = document.createElement('div');
        tagComments.textContent = item.comments;
        tagComments.className = 'tag-comments';
        tagInfo.appendChild(tagComments);
      }

      tagItem.addEventListener('click', (e) => {
        if (e.target === checkbox) return;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      });

      tagItem.appendChild(checkbox);
      tagItem.appendChild(tagInfo);
      resultsContainer.appendChild(tagItem);
    });
  }

  const validItems = taggingData.data.filter((item) => item.value);

  searchInput.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = validItems.filter((item) => (
      item.value.toLowerCase().includes(term)
      || item.key.toLowerCase().includes(term)
      || (item.comments && item.comments.toLowerCase().includes(term))
    ));
    renderTagList(filtered);
  });

  selectAllBtn.addEventListener('click', () => {
    validItems.forEach((item) => selectedTags.add(item.key));
    renderTagList(validItems);
    updateSendButton();
  });

  deselectAllBtn.addEventListener('click', () => {
    selectedTags.clear();
    renderTagList(validItems);
    updateSendButton();
  });

  sendBtn.addEventListener('click', async () => {
    if (selectedTags.size === 0) return;
    try {
      await actions.sendText(Array.from(selectedTags).join(', '));
      await actions.closeLibrary();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error sending selected tags:', error);
      const originalText = sendBtn.textContent;
      const originalClass = sendBtn.className;
      sendBtn.textContent = 'Error sending tags';
      sendBtn.className = 'btn btn-error';
      sendBtn.disabled = true;
      setTimeout(() => {
        sendBtn.textContent = originalText;
        sendBtn.className = originalClass;
        sendBtn.disabled = false;
      }, 2000);
    }
  });

  const actionContainer = document.createElement('div');
  actionContainer.className = 'action-container';
  actionContainer.appendChild(selectAllBtn);
  actionContainer.appendChild(deselectAllBtn);
  actionContainer.appendChild(sendBtn);
  container.appendChild(actionContainer);

  renderTagList(validItems);
  document.body.appendChild(container);
}

async function init() {
  try {
    const { context, actions } = await DA_SDK;
    const taggingData = await fetchTaggingData(actions, context.org, context.repo);
    displayTaggingData(taggingData, actions);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error initializing tags tool:', error);
    showMessage(document.body, 'error-message', 'Error initializing tags tool');
  }
}

init();
