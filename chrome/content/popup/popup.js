// Initialize the UI
updateFileList();

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('optionsButton').addEventListener('click', function () {
    if (chrome.runtime.openOptionsPage) {
      // New way to open options pages, introduced in Chrome 42.
      chrome.runtime.openOptionsPage();
    } else {
      // Reasonable fallback.
      window.open(chrome.runtime.getURL('options.html'));
    }
  });

  setupFileUpload();

  var updatePageButton = document.getElementById('updatePageButton');
  updatePageButton.addEventListener('click', updateLabelsOnPage);
});

function setupFileUpload() {
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('jsonFile');

  // Handle drag and drop events
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.add('drag-over');
  });

  uploadArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.remove('drag-over');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.remove('drag-over');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files[0]);
      fileInput.value = ''; // Reset file input after drop
    }
  });

  // Handle click to upload
  uploadArea.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
      fileInput.value = ''; // Reset file input after selection
    }
  });
}

function handleFileUpload(file) {
  const uploadArea = document.getElementById('uploadArea');
  const statusText = uploadArea.querySelector('.status-text');

  // Add loading class to the upload area to show the status text & loading spinner

  if (!file.name.toLowerCase().endsWith('.json')) {
    uploadArea.classList.add('error');
    statusText.innerText = 'Please select a JSON file.';
    setTimeout(() => {
      statusText.innerText = '';
      uploadArea.classList.remove('error');
    }, 2000);
    return;
  }

  uploadArea.classList.add('loading');
  statusText.innerText = 'Loading JSON file...';

  const reader = new FileReader();

  reader.onload = function (e) {
    var parsedData;
    try {
      statusText.innerText = 'Parsing JSON file ' + file.name + '...';
      parsedData = JSON.parse(e.target.result);
    } catch (error) {
      statusText.innerText = 'Error parsing JSON file: ' + error.message;
      uploadArea.classList.remove('loading');
      return;
    }

    GuidStorage.addFile(file.name, parsedData).then(function() {
      statusText.innerText = 'JSON file uploaded successfully';
      setTimeout(() => {
        uploadArea.classList.remove('loading');
        statusText.innerText = '';
      }, 1000);
      updateFileList();
    }).catch(function(error) {
      statusText.innerText = 'JSON file upload error: ' + (error.message || JSON.stringify(error));
      uploadArea.classList.remove('loading');
      updateFileList();
    });
  };

  reader.onerror = function() {
    statusText.innerText = 'Error reading file';
    uploadArea.classList.remove('loading');
  };

  reader.readAsText(file);
}

function updateFileList() {
  var fileListDiv = document.getElementById('fileList');
  var totalEntriesDiv = document.getElementById('totalEntries');

  Promise.all([GuidStorage.getFiles(), GuidStorage.getMergedCount()]).then(function([fileList, totalEntries]) {
    if (fileList.length === 0) {
      fileListDiv.innerHTML = '<div class="file-item">No files uploaded</div>';
      totalEntriesDiv.textContent = 'Total entries: 0';
      return;
    }

    var files = fileList.map(file => [file.id, file]);

    fileListDiv.innerHTML = files.map(([fileId, fileData]) => {
      return `
        <div class="file-item" data-file-id="${fileId}">
          <div>${fileData.fileName}</div>
          <div style="font-size: 0.8em; color: #666;">${fileData.creationDate}</div>
          ${fileData.projectName ? `<div style="font-size: 0.8em; color: #666;">${fileData.projectName} ${fileData.projectVersion ? `- ${fileData.projectVersion}` : ''}</div>` : ''}
          <div style="font-size: 0.8em;">
            ${Object.keys(fileData.mapping).length} entries
            <a href="#" class="download-link" data-file-id="${fileId}">Download</a>
          </div>
          <button class="delete-btn" data-file-id="${fileId}">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
              <path d="M18 6l-12 12" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
      `;
    }).join('');

    totalEntriesDiv.textContent = `Total unique entries: ${totalEntries}`;

    // Add delete button listeners
    fileListDiv.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const button = this;
        button.classList.add('loading');
        deleteFile(this.dataset.fileId);
      });
    });

    // Add download link listeners
    fileListDiv.querySelectorAll('.download-link').forEach(link => {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        downloadFileData(this.dataset.fileId);
      });
    });
  });
}

function deleteFile(fileId) {
  GuidStorage.removeFile(fileId).then(updateFileList);
}

function updateLabelsOnPage() {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var activeTab = tabs[0];
    chrome.tabs.sendMessage(activeTab.id, { message: "addGuidLabels" }, function (response) { });
  });
}

function downloadFileData(fileId) {
  GuidStorage.getFile(fileId).then(function(fileData) {
    if (!fileData) return;

    const blob = new Blob([GuidStorage.toJson(fileData)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = fileData.fileName;
    document.body.appendChild(a);
    a.click();

    // Cleanup
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  });
}
