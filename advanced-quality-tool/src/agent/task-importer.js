/**
 * Task File Importer for P9-T008
 * 
 * Supports importing task JSON files for the coding agent workbench.
 * Handles phase task format validation, parsing, and task selection.
 */

const fs = require('fs');
const path = require('path');

/**
 * Task importer class that handles JSON parsing, validation, and task management
 */
class TaskImporter {
  constructor(workspacePath) {
    this.workspacePath = workspacePath;
    this.currentTaskFile = null;
    this.importedTasks = [];
    this.selectedTasks = [];
  }

  /**
   * Select a task JSON file by path
   * @param {string} filePath - Path to task JSON file
   * @returns {object} Import result with tasks and validation info
   */
  selectTaskFile(filePath) {
    try {
      const absolutePath = path.isAbsolute(filePath) 
        ? filePath 
        : path.join(this.workspacePath, filePath);
      
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`Task file not found: ${absolutePath}`);
      }

      const fileContent = fs.readFileSync(absolutePath, 'utf8');
      const parsed = JSON.parse(fileContent);
      
      // Validate and parse the task file
      const result = this.parseTaskFile(parsed, absolutePath);
      
      this.currentTaskFile = {
        path: absolutePath,
        name: path.basename(absolutePath),
        lastModified: fs.statSync(absolutePath).mtime
      };
      
      this.importedTasks = result.tasks;
      
      return {
        success: true,
        file: this.currentTaskFile,
        tasks: result.tasks,
        validation: result.validation,
        warnings: result.warnings,
        errors: result.errors
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        filePath: filePath,
        actionableError: this.getActionableErrorMessage(error)
      };
    }
  }

  /**
   * Parse and validate task file content
   * @param {object} parsed - Parsed JSON content
   * @param {string} filePath - Source file path
   * @returns {object} Parsing result
   */
  parseTaskFile(parsed, filePath) {
    const validation = {
      isValid: false,
      format: 'unknown',
      schemaVersion: null,
      phase: null
    };
    
    const warnings = [];
    const errors = [];

    // Check if it's a phase task file
    if (this.isPhaseTaskFile(parsed)) {
      validation.format = 'phase-task';
      validation.phase = parsed.phase;
      validation.schemaVersion = 'phase-task-v1';
      
      if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
        errors.push('Phase task file must contain a "tasks" array');
      } else {
        validation.isValid = true;
        const tasks = this.extractTasksFromPhaseFile(parsed, warnings);
        return { tasks, validation, warnings, errors };
      }
    }
    // Check if it's a standalone task array
    else if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].id) {
      validation.format = 'task-array';
      validation.isValid = true;
      const tasks = this.validateAndEnhanceTasks(parsed, warnings);
      return { tasks, validation, warnings, errors };
    }
    // Check if it's a grouped task collection
    else if (parsed.tasks && Array.isArray(parsed.tasks) && parsed.tasks.length > 0 && parsed.tasks[0].id) {
      validation.format = 'grouped-tasks';
      validation.isValid = true;
      const tasks = this.validateAndEnhanceTasks(parsed.tasks, warnings);
      return { tasks, validation, warnings, errors };
    }
    // Check if it's master task index
    else if (parsed.phaseFiles && parsed.activePhase) {
      validation.format = 'master-index';
      validation.isValid = true;
      warnings.push('Master task index selected. Individual phase files should be imported separately.');
      return { tasks: [], validation, warnings, errors };
    }
    else {
      errors.push('Unsupported task file format. Expected phase task file, task array, or grouped task collection.');
      return { tasks: [], validation, warnings, errors };
    }
  }

  /**
   * Check if the parsed content is a phase task file
   * @param {object} parsed - Parsed JSON
   * @returns {boolean}
   */
  isPhaseTaskFile(parsed) {
    return (
      typeof parsed === 'object' &&
      parsed.phase &&
      typeof parsed.phase === 'string' &&
      parsed.phase.startsWith('phase')
    );
  }

  /**
   * Extract tasks from phase task file
   * @param {object} phaseFile - Phase task file object
   * @param {Array} warnings - Warnings array to populate
   * @returns {Array} Enhanced task list
   */
  extractTasksFromPhaseFile(phaseFile, warnings) {
    const tasks = phaseFile.tasks || [];
    const enhancedTasks = tasks.map(task => ({
      ...task,
      phase: phaseFile.phase,
      sourceFile: this.currentTaskFile?.name || 'unknown'
    }));
    
    return this.validateAndEnhanceTasks(enhancedTasks, warnings);
  }

  /**
   * Validate and enhance tasks with additional metadata
   * @param {Array} tasks - Task array
   * @param {Array} warnings - Warnings array to populate
   * @returns {Array} Validated and enhanced tasks
   */
  validateAndEnhanceTasks(tasks, warnings) {
    const validTasks = [];
    
    tasks.forEach((task, index) => {
      // Basic validation
      if (!task.id) {
        warnings.push(`Task at index ${index} missing "id" field`);
        return;
      }
      
      if (!task.name) {
        warnings.push(`Task ${task.id} missing "name" field`);
      }
      
      if (!task.status) {
        warnings.push(`Task ${task.id} missing "status" field`);
        task.status = 'PENDING';
      }
      
      // Add selection metadata
      const enhancedTask = {
        ...task,
        _importedAt: new Date().toISOString(),
        _selected: false,
        _originalIndex: index
      };
      
      validTasks.push(enhancedTask);
    });
    
    return validTasks;
  }

  /**
   * Get actionable error message for different error types
   * @param {Error} error - Original error
   * @returns {string} Actionable error message
   */
  getActionableErrorMessage(error) {
    if (error.message.includes('not found')) {
      return 'File not found. Check the path and try again.';
    }
    
    if (error.message.includes('Unexpected token')) {
      return 'Invalid JSON format. Check for syntax errors in the file.';
    }
    
    if (error.message.includes('phase')) {
      return 'Invalid phase task format. Expected "phase" field starting with "phase".';
    }
    
    return error.message;
  }

  /**
   * Select/deselect tasks for agent execution
   * @param {Array} taskIds - Array of task IDs to select
   * @param {boolean} select - True to select, false to deselect
   */
  selectTasks(taskIds, select = true) {
    this.importedTasks.forEach(task => {
      if (taskIds.includes(task.id)) {
        task._selected = select;
      }
    });
    
    this.selectedTasks = this.importedTasks.filter(task => task._selected);
  }

  /**
   * Get selected tasks for agent execution
   * @returns {Array} Selected tasks
   */
  getSelectedTasks() {
    return this.selectedTasks.map(task => {
      const { _importedAt, _selected, _originalIndex, ...cleanTask } = task;
      return cleanTask;
    });
  }

  /**
   * Clear current task file and imported tasks
   */
  clear() {
    this.currentTaskFile = null;
    this.importedTasks = [];
    this.selectedTasks = [];
  }

  /**
   * Refresh task file (reload from disk)
   * @returns {object} Refresh result
   */
  refresh() {
    if (!this.currentTaskFile) {
      return {
        success: false,
        error: 'No task file loaded to refresh'
      };
    }
    
    return this.selectTaskFile(this.currentTaskFile.path);
  }

  /**
   * Get summary of imported tasks
   * @returns {object} Task summary
   */
  getTaskSummary() {
    const statusCounts = {
      PENDING: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      BLOCKED: 0,
      CANCELLED: 0
    };
    
    const priorityCounts = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0
    };
    
    let totalEstimatedHours = 0;
    let totalValue = 0;
    
    this.importedTasks.forEach(task => {
      statusCounts[task.status] = (statusCounts[task.status] || 0) + 1;
      priorityCounts[task.priority] = (priorityCounts[task.priority] || 0) + 1;
      totalEstimatedHours += task.estimatedHours || 0;
      totalValue += task.value || 0;
    });
    
    return {
      totalTasks: this.importedTasks.length,
      selectedTasks: this.selectedTasks.length,
      statusCounts,
      priorityCounts,
      totalEstimatedHours,
      totalValue,
      phases: [...new Set(this.importedTasks.map(t => t.phase).filter(Boolean))]
    };
  }
}

module.exports = TaskImporter;