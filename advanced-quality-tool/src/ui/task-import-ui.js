/**
 * Task Import UI Component for P9-T008
 * 
 * Provides file picker, drag-and-drop, and task selection UI
 * for the coding agent workbench.
 */

class TaskImportUI {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container element not found: ${containerId}`);
    }
    
    this.options = {
      workspacePath: options.workspacePath || '.',
      onTaskFileSelected: options.onTaskFileSelected || (() => {}),
      onTasksSelected: options.onTasksSelected || (() => {}),
      onError: options.onError || (() => {}),
      showSummary: options.showSummary !== false,
      allowMultiSelect: options.allowMultiSelect !== false
    };
    
    this.taskImporter = null;
    this.initializeUI();
  }

  /**
   * Initialize the UI components
   */
  initializeUI() {
    this.container.innerHTML = `
      <div class="task-import-ui">
        <div class="file-selection-section">
          <h3>Task File Import</h3>
          <div class="file-input-area">
            <div class="drag-drop-zone" id="dragDropZone">
              <div class="drag-drop-content">
                <svg class="upload-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <p class="drag-drop-text">Drag & drop task JSON file here</p>
                <p class="drag-drop-subtext">or click to browse</p>
                <input type="file" id="fileInput" accept=".json" style="display: none;">
                <button class="browse-button" id="browseButton">Browse Files</button>
              </div>
            </div>
            <div class="file-path-input">
              <label for="pathInput">Or enter file path:</label>
              <div class="path-input-group">
                <input type="text" id="pathInput" placeholder="./tasks/phase9-tasks.json">
                <button class="load-button" id="loadButton">Load</button>
              </div>
            </div>
          </div>
          
          <div class="current-file-info" id="currentFileInfo" style="display: none;">
            <h4>Current Task File</h4>
            <div class="file-info-content">
              <div class="file-name" id="fileName"></div>
              <div class="file-details">
                <span class="file-path" id="filePath"></span>
                <span class="file-modified" id="fileModified"></span>
              </div>
              <button class="refresh-button" id="refreshButton">Refresh</button>
              <button class="clear-button" id="clearButton">Clear</button>
            </div>
          </div>
        </div>
        
        <div class="task-selection-section" id="taskSelectionSection" style="display: none;">
          <div class="section-header">
            <h3>Task Selection</h3>
            <div class="selection-controls">
              <button class="select-all-button" id="selectAllButton">Select All</button>
              <button class="deselect-all-button" id="deselectAllButton">Deselect All</button>
              <button class="execute-button" id="executeButton">Execute Selected Tasks</button>
            </div>
          </div>
          
          <div class="task-summary" id="taskSummary" style="display: none;"></div>
          
          <div class="task-list-container">
            <div class="task-list-header">
              <div class="header-checkbox">
                <input type="checkbox" id="headerCheckbox">
              </div>
              <div class="header-id">ID</div>
              <div class="header-name">Name</div>
              <div class="header-status">Status</div>
              <div class="header-priority">Priority</div>
              <div class="header-hours">Hours</div>
            </div>
            <div class="task-list" id="taskList"></div>
          </div>
          
          <div class="validation-info" id="validationInfo"></div>
        </div>
        
        <div class="status-message" id="statusMessage"></div>
      </div>
    `;
    
    // Initialize TaskImporter
    this.taskImporter = new (require('../agent/task-importer'))(this.options.workspacePath);
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Apply basic styles if not already present
    this.applyStyles();
  }

  /**
   * Apply CSS styles for the component
   */
  applyStyles() {
    if (document.getElementById('task-import-ui-styles')) {
      return;
    }
    
    const style = document.createElement('style');
    style.id = 'task-import-ui-styles';
    style.textContent = `
      .task-import-ui {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        padding: 20px;
        background: #f5f5f5;
        border-radius: 8px;
        max-width: 1000px;
        margin: 0 auto;
      }
      
      h3 {
        margin-top: 0;
        color: #333;
        font-size: 18px;
      }
      
      .file-input-area {
        margin: 20px 0;
      }
      
      .drag-drop-zone {
        border: 2px dashed #ccc;
        border-radius: 8px;
        padding: 40px;
        text-align: center;
        background: white;
        margin-bottom: 20px;
        transition: border-color 0.3s;
        cursor: pointer;
      }
      
      .drag-drop-zone.drag-over {
        border-color: #007acc;
        background: #f0f8ff;
      }
      
      .drag-drop-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }
      
      .upload-icon {
        color: #666;
        margin-bottom: 8px;
      }
      
      .drag-drop-text {
        font-size: 16px;
        font-weight: 500;
        color: #333;
        margin: 0;
      }
      
      .drag-drop-subtext {
        font-size: 14px;
        color: #666;
        margin: 0;
      }
      
      .browse-button, .load-button, .refresh-button, .clear-button,
      .select-all-button, .deselect-all-button, .execute-button {
        padding: 8px 16px;
        background: #007acc;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        transition: background 0.2s;
      }
      
      .browse-button:hover, .load-button:hover {
        background: #005a9e;
      }
      
      .file-path-input {
        margin-top: 20px;
      }
      
      .file-path-input label {
        display: block;
        margin-bottom: 8px;
        font-weight: 500;
        color: #333;
      }
      
      .path-input-group {
        display: flex;
        gap: 8px;
      }
      
      #pathInput {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 14px;
      }
      
      .current-file-info {
        background: white;
        padding: 16px;
        border-radius: 8px;
        margin-top: 20px;
        border: 1px solid #ddd;
      }
      
      .file-info-content {
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
      }
      
      .file-name {
        font-weight: 600;
        color: #333;
      }
      
      .file-details {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12px;
        color: #666;
      }
      
      .refresh-button, .clear-button {
        background: #666;
      }
      
      .refresh-button:hover, .clear-button:hover {
        background: #555;
      }
      
      .task-selection-section {
        margin-top: 30px;
      }
      
      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
      }
      
      .selection-controls {
        display: flex;
        gap: 8px;
      }
      
      .select-all-button, .deselect-all-button {
        background: #666;
      }
      
      .select-all-button:hover, .deselect-all-button:hover {
        background: #555;
      }
      
      .execute-button {
        background: #28a745;
      }
      
      .execute-button:hover {
        background: #218838;
      }
      
      .task-summary {
        background: white;
        padding: 16px;
        border-radius: 8px;
        margin-bottom: 20px;
        border: 1px solid #ddd;
      }
      
      .task-list-container {
        background: white;
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid #ddd;
      }
      
      .task-list-header {
        display: flex;
        background: #f8f9fa;
        padding: 12px 16px;
        border-bottom: 1px solid #ddd;
        font-weight: 600;
        color: #333;
        font-size: 14px;
      }
      
      .header-checkbox {
        width: 40px;
        display: flex;
        align-items: center;
      }
      
      .header-id {
        width: 100px;
      }
      
      .header-name {
        flex: 1;
      }
      
      .header-status {
        width: 100px;
      }
      
      .header-priority {
        width: 100px;
      }
      
      .header-hours {
        width: 80px;
        text-align: right;
      }
      
      .task-list {
        max-height: 400px;
        overflow-y: auto;
      }
      
      .task-item {
        display: flex;
        padding: 12px 16px;
        border-bottom: 1px solid #eee;
        align-items: center;
        transition: background 0.2s;
      }
      
      .task-item:hover {
        background: #f8f9fa;
      }
      
      .task-item.selected {
        background: #e8f4fd;
      }
      
      .task-checkbox {
        width: 40px;
      }
      
      .task-id {
        width: 100px;
        font-family: monospace;
        font-size: 13px;
        color: #007acc;
      }
      
      .task-name {
        flex: 1;
        font-size: 14px;
      }
      
      .task-status {
        width: 100px;
      }
      
      .task-priority {
        width: 100px;
      }
      
      .task-hours {
        width: 80px;
        text-align: right;
        font-size: 14px;
        color: #666;
      }
      
      .status-badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 500;
      }
      
      .status-pending {
        background: #fff3cd;
        color: #856404;
      }
      
      .status-completed {
        background: #d4edda;
        color: #155724;
      }
      
      .status-in-progress {
        background: #d1ecf1;
        color: #0c5460;
      }
      
      .priority-badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 500;
      }
      
      .priority-critical {
        background: #f8d7da;
        color: #721c24;
      }
      
      .priority-high {
        background: #ffeaa7;
        color: #5d4a00;
      }
      
      .priority-medium {
        background: #d1ecf1;
        color: #0c5460;
      }
      
      .priority-low {
        background: #d4edda;
        color: #155724;
      }
      
      .validation-info {
        margin-top: 20px;
        padding: 16px;
        border-radius: 8px;
        font-size: 14px;
      }
      
      .validation-success {
        background: #d4edda;
        color: #155724;
        border: 1px solid #c3e6cb;
      }
      
      .validation-warning {
        background: #fff3cd;
        color: #856404;
        border: 1px solid #ffeaa7;
      }
      
      .validation-error {
        background: #f8d7da;
        color: #721c24;
        border: 1px solid #f5c6cb;
      }
      
      .status-message {
        margin-top: 20px;
        padding: 12px 16px;
        border-radius: 4px;
        font-size: 14px;
      }
      
      .message-success {
        background: #d4edda;
        color: #155724;
        border: 1px solid #c3e6cb;
      }
      
      .message-error {
        background: #f8d7da;
        color: #721c24;
        border: 1px solid #f5c6cb;
      }
      
      .message-info {
        background: #d1ecf1;
        color: #0c5460;
        border: 1px solid #bee5eb;
      }
    `;
    
    document.head.appendChild(style);
  }

  /**
   * Set up event listeners for UI interactions
   */
  setupEventListeners() {
    // Drag and drop
    const dragDropZone = document.getElementById('dragDropZone');
    const fileInput = document.getElementById('fileInput');
    const browseButton = document.getElementById('browseButton');
    const pathInput = document.getElementById('pathInput');
    const loadButton = document.getElementById('loadButton');
    const refreshButton = document.getElementById('refreshButton');
    const clearButton = document.getElementById('clearButton');
    const selectAllButton = document.getElementById('selectAllButton');
    const deselectAllButton = document.getElementById('deselectAllButton');
    const executeButton = document.getElementById('executeButton');
    const headerCheckbox = document.getElementById('headerCheckbox');

    // File input via drag and drop
    dragDropZone.addEventListener('click', () => fileInput.click());
    dragDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dragDropZone.classList.add('drag-over');
    });
    dragDropZone.addEventListener('dragleave', () => {
      dragDropZone.classList.remove('drag-over');
    });
    dragDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDropZone.classList.remove('drag-over');
      
      if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.name.endsWith('.json')) {
          this.loadTaskFile(file.path);
        } else {
          this.showMessage('Please select a JSON file', 'error');
        }
      }
    });

    // File input via browse button
    browseButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.loadTaskFile(e.target.files[0].path);
      }
    });

    // Load via path input
    loadButton.addEventListener('click', () => {
      const filePath = pathInput.value.trim();
      if (filePath) {
        this.loadTaskFile(filePath);
      }
    });

    pathInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        loadButton.click();
      }
    });

    // File management buttons
    refreshButton.addEventListener('click', () => this.refreshTaskFile());
    clearButton.addEventListener('click', () => this.clearTaskFile());

    // Task selection buttons
    selectAllButton.addEventListener('click', () => this.selectAllTasks());
    deselectAllButton.addEventListener('click', () => this.deselectAllTasks());
    executeButton.addEventListener('click', () => this.executeSelectedTasks());

    // Header checkbox for select/deselect all
    headerCheckbox.addEventListener('change', (e) => {
      const checkboxes = document.querySelectorAll('.task-checkbox input');
      checkboxes.forEach(cb => {
        cb.checked = e.target.checked;
        cb.dispatchEvent(new Event('change'));
      });
    });
  }

  /**
   * Load task file from path
   * @param {string} filePath - Path to task JSON file
   */
  async loadTaskFile(filePath) {
    try {
      this.showMessage('Loading task file...', 'info');
      
      const result = this.taskImporter.selectTaskFile(filePath);
      
      if (result.success) {
        this.showCurrentFileInfo(result.file);
        this.showTaskSelectionSection();
        this.renderTaskList(result.tasks);
        this.showValidationInfo(result);
        this.showTaskSummary();
        
        this.showMessage(`Successfully loaded ${result.tasks.length} tasks from ${result.file.name}`, 'success');
        
        // Callback
        this.options.onTaskFileSelected(result);
      } else {
        this.showMessage(`Failed to load task file: ${result.actionableError || result.error}`, 'error');
        this.options.onError(result);
      }
    } catch (error) {
      this.showMessage(`Error loading task file: ${error.message}`, 'error');
      this.options.onError({ error: error.message });
    }
  }

  /**
   * Show current file information
   * @param {object} fileInfo - File information object
   */
  showCurrentFileInfo(fileInfo) {
    const container = document.getElementById('currentFileInfo');
    const fileName = document.getElementById('fileName');
    const filePath = document.getElementById('filePath');
    const fileModified = document.getElementById('fileModified');
    
    fileName.textContent = fileInfo.name;
    filePath.textContent = fileInfo.path;
    fileModified.textContent = `Last modified: ${new Date(fileInfo.lastModified).toLocaleString()}`;
    
    container.style.display = 'block';
  }

  /**
   * Show task selection section
   */
  showTaskSelectionSection() {
    document.getElementById('taskSelectionSection').style.display = 'block';
  }

  /**
   * Render task list
   * @param {Array} tasks - Task array
   */
  renderTaskList(tasks) {
    const taskList = document.getElementById('taskList');
    taskList.innerHTML = '';
    
    tasks.forEach(task => {
      const taskItem = document.createElement('div');
      taskItem.className = `task-item ${task._selected ? 'selected' : ''}`;
      taskItem.innerHTML = `
        <div class="task-checkbox">
          <input type="checkbox" class="task-checkbox-input" 
                 data-task-id="${task.id}" 
                 ${task._selected ? 'checked' : ''}>
        </div>
        <div class="task-id">${task.id}</div>
        <div class="task-name">${task.name}</div>
        <div class="task-status">
          <span class="status-badge status-${task.status.toLowerCase().replace('_', '-')}">
            ${task.status}
          </span>
        </div>
        <div class="task-priority">
          <span class="priority-badge priority-${task.priority ? task.priority.toLowerCase() : 'medium'}">
            ${task.priority || 'MEDIUM'}
          </span>
        </div>
        <div class="task-hours">${task.estimatedHours || 0}h</div>
      `;
      
      taskList.appendChild(taskItem);
    });
    
    // Add event listeners to checkboxes
    const checkboxes = taskList.querySelectorAll('.task-checkbox-input');
    checkboxes.forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const taskId = e.target.getAttribute('data-task-id');
        const isChecked = e.target.checked;
        
        this.taskImporter.selectTasks([taskId], isChecked);
        
        // Update visual selection
        const taskItem = e.target.closest('.task-item');
        if (isChecked) {
          taskItem.classList.add('selected');
        } else {
          taskItem.classList.remove('selected');
        }
        
        // Update summary
        this.showTaskSummary();
        
        // Callback
        this.options.onTasksSelected(this.taskImporter.getSelectedTasks());
      });
    });
  }

  /**
   * Show validation information
   * @param {object} result - Import result
   */
  showValidationInfo(result) {
    const validationInfo = document.getElementById('validationInfo');
    
    let html = '';
    let className = 'validation-success';
    
    if (result.errors && result.errors.length > 0) {
      className = 'validation-error';
      html += `<strong>Errors:</strong><ul>`;
      result.errors.forEach(error => html += `<li>${error}</li>`);
      html += `</ul>`;
    }
    
    if (result.warnings && result.warnings.length > 0) {
      if (className === 'validation-success') {
        className = 'validation-warning';
      }
      html += `<strong>Warnings:</strong><ul>`;
      result.warnings.forEach(warning => html += `<li>${warning}</li>`);
      html += `</ul>`;
    }
    
    if (html) {
      validationInfo.className = `validation-info ${className}`;
      validationInfo.innerHTML = html;
      validationInfo.style.display = 'block';
    } else {
      validationInfo.style.display = 'none';
    }
  }

  /**
   * Show task summary
   */
  showTaskSummary() {
    if (!this.options.showSummary) return;
    
    const summary = this.taskImporter.getTaskSummary();
    const summaryElement = document.getElementById('taskSummary');
    
    let html = `
      <div class="summary-content">
        <strong>Task Summary:</strong>
        <div style="display: flex; gap: 20px; margin-top: 8px; flex-wrap: wrap;">
          <div><strong>Total:</strong> ${summary.totalTasks} tasks</div>
          <div><strong>Selected:</strong> ${summary.selectedTasks} tasks</div>
          <div><strong>Pending:</strong> ${summary.statusCounts.PENDING || 0}</div>
          <div><strong>Completed:</strong> ${summary.statusCounts.COMPLETED || 0}</div>
          <div><strong>Hours:</strong> ${summary.totalEstimatedHours}h</div>
          <div><strong>Value:</strong> ${summary.totalValue}</div>
    `;
    
    if (summary.phases && summary.phases.length > 0) {
      html += `<div><strong>Phases:</strong> ${summary.phases.join(', ')}</div>`;
    }
    
    html += `</div></div>`;
    
    summaryElement.innerHTML = html;
    summaryElement.style.display = 'block';
  }

  /**
   * Refresh current task file
   */
  async refreshTaskFile() {
    const result = this.taskImporter.refresh();
    
    if (result.success) {
      this.renderTaskList(result.tasks);
      this.showValidationInfo(result);
      this.showTaskSummary();
      this.showMessage('Task file refreshed successfully', 'success');
    } else {
      this.showMessage(`Failed to refresh: ${result.error}`, 'error');
    }
  }

  /**
   * Clear current task file
   */
  clearTaskFile() {
    this.taskImporter.clear();
    
    document.getElementById('currentFileInfo').style.display = 'none';
    document.getElementById('taskSelectionSection').style.display = 'none';
    document.getElementById('taskList').innerHTML = '';
    document.getElementById('validationInfo').style.display = 'none';
    document.getElementById('taskSummary').style.display = 'none';
    document.getElementById('pathInput').value = '';
    
    this.showMessage('Task file cleared', 'info');
  }

  /**
   * Select all tasks
   */
  selectAllTasks() {
    const allTaskIds = this.taskImporter.importedTasks.map(task => task.id);
    this.taskImporter.selectTasks(allTaskIds, true);
    
    const checkboxes = document.querySelectorAll('.task-checkbox-input');
    checkboxes.forEach(cb => {
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
    });
    
    document.getElementById('headerCheckbox').checked = true;
  }

  /**
   * Deselect all tasks
   */
  deselectAllTasks() {
    const allTaskIds = this.taskImporter.importedTasks.map(task => task.id);
    this.taskImporter.selectTasks(allTaskIds, false);
    
    const checkboxes = document.querySelectorAll('.task-checkbox-input');
    checkboxes.forEach(cb => {
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));
    });
    
    document.getElementById('headerCheckbox').checked = false;
  }

  /**
   * Execute selected tasks
   */
  executeSelectedTasks() {
    const selectedTasks = this.taskImporter.getSelectedTasks();
    
    if (selectedTasks.length === 0) {
      this.showMessage('No tasks selected for execution', 'error');
      return;
    }
    
    this.showMessage(`Starting execution of ${selectedTasks.length} selected tasks...`, 'info');
    
    // This would typically trigger agent execution
    console.log('Selected tasks for execution:', selectedTasks);
    
    // Callback for execution
    if (this.options.onTasksSelected) {
      this.options.onTasksSelected(selectedTasks);
    }
  }

  /**
   * Show status message
   * @param {string} message - Message text
   * @param {string} type - Message type (success, error, info)
   */
  showMessage(message, type = 'info') {
    const statusMessage = document.getElementById('statusMessage');
    statusMessage.textContent = message;
    statusMessage.className = `status-message message-${type}`;
    statusMessage.style.display = 'block';
    
    // Auto-hide success messages after 5 seconds
    if (type === 'success') {
      setTimeout(() => {
        if (statusMessage.textContent === message) {
          statusMessage.style.display = 'none';
        }
      }, 5000);
    }
  }

  /**
   * Get currently selected tasks
   * @returns {Array} Selected tasks
   */
  getSelectedTasks() {
    return this.taskImporter.getSelectedTasks();
  }

  /**
   * Get task importer instance
   * @returns {TaskImporter} Task importer instance
   */
  getImporter() {
    return this.taskImporter;
  }
}

// Export for Node.js (for testing)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TaskImportUI;
}

// Auto-initialize if script is loaded in browser with data attributes
if (typeof window !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const containers = document.querySelectorAll('[data-task-import-ui]');
    containers.forEach(container => {
      const options = {
        workspacePath: container.getAttribute('data-workspace-path'),
        showSummary: container.getAttribute('data-show-summary') !== 'false',
        allowMultiSelect: container.getAttribute('data-allow-multi-select') !== 'false'
      };
      
      try {
        new TaskImportUI(container.id, options);
      } catch (error) {
        console.error('Failed to initialize TaskImportUI:', error);
      }
    });
  });
}