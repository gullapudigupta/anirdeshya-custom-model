// src/utils/toolExecutor.js
const { execSync, spawn } = require('child_process');
const logger = require('./logger');
const config = require('../config/config');

class ToolExecutor {
  static executeSync(toolName, args = [], options = {}) {
    try {
      const cmd = this.buildCommand(toolName, args);
      logger.debug(`Executing: ${cmd}`, { tool: toolName, args });
      const result = execSync(cmd, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        cwd: config.repoRoot,
        ...options
      });
      return result;
    } catch (error) {
      logger.error(`Tool execution failed: ${toolName}`, { error: error.message, stderr: error.stderr });
      throw error;
    }
  }

  static executeSpawn(toolName, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      try {
        const tool = this.getToolPath(toolName);
        logger.debug(`Spawning: ${tool}`, { args });
        const proc = spawn(tool, args, {
          cwd: config.repoRoot,
          windowsHide: true,
          ...options
        });

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data) => { stdout += data.toString(); });
        proc.stderr?.on('data', (data) => { stderr += data.toString(); });

        proc.on('close', (code) => {
          if (code !== 0) {
            logger.warn(`Tool execution warning: ${toolName} exited with code ${code}`, { stderr });
          }
          resolve({ stdout, stderr, code });
        });

        proc.on('error', (error) => {
          logger.error(`Tool spawn error: ${toolName}`, { error: error.message });
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  static buildCommand(toolName, args = []) {
    const tool = this.getToolPath(toolName);
    const escapedArgs = args.map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(' ');
    return `"${tool}" ${escapedArgs}`;
  }

  static getToolPath(toolName) {
    return toolName;
  }
}

module.exports = { ToolExecutor };
