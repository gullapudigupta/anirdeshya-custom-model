    // State management
    const state = {
      issues: [],
      selectedIssue: null,
      tasks: [],
      activeSidebarView: 'issues',
      chatHistory: [],
      stats: {
        total: 0,
        fixed: 0,
        successRate: 0
      },
      websocket: null,
      websocketConnected: false,
      pipelineState: null,
      agentState: null,
      // Issue Filtering (P11-T011)
      filters: {
        severity: null,
        category: null,
        file: null
      },
      filteredIssues: [],
      // Search Functionality (P11-T012)
      searchQuery: '',
      searchResults: [],
      // Multi-Issue Selection (P11-T013)
      selectedIssues: new Set(),
      multiSelectMode: false,
      // Metrics Dashboard (P11-T016)
      metricsData: null,
      metricsLoaded: false
    };

    // DOM elements
    const elements = {
      issuesList: document.getElementById('issuesList'),
      sidebarStatus: document.getElementById('sidebarStatus'),
      analyzeBtn: document.getElementById('analyzeBtn'),
      loadTasksBtn: document.getElementById('loadTasksBtn'),
      tasksFile: document.getElementById('tasksFile'),
      issuesTab: document.getElementById('issuesTab'),
      tasksTab: document.getElementById('tasksTab'),
      pipelineTab: document.getElementById('pipelineTab'),
      agentTab: document.getElementById('agentTab'),
      aiTab: document.getElementById('aiTab'),
      messages: document.getElementById('messages'),
      messageInput: document.getElementById('messageInput'),
      sendBtn: document.getElementById('sendBtn'),
      totalIssues: document.getElementById('totalIssues'),
      fixedCount: document.getElementById('fixedCount'),
      successRate: document.getElementById('successRate'),
      issueCount: document.getElementById('issueCount'),
      taskCount: document.getElementById('taskCount'),
      pipelinePanel: document.getElementById('pipelinePanel'),
      agentPanel: document.getElementById('agentPanel'),
      metricsTab: document.getElementById('metricsTab'),
      metricsPanel: document.getElementById('metricsPanel')
    };

    // Initialize
    function init() {
      // Event listeners
      elements.sendBtn.addEventListener('click', sendMessage);
      elements.analyzeBtn.addEventListener('click', () => analyzeProject());
      
      // Security Scan Button (P11-T015)
      const securityScanBtn = document.getElementById('securityScanBtn');
      if (securityScanBtn) {
        securityScanBtn.addEventListener('click', () => runSecurityScan());
      }
      
      elements.loadTasksBtn.addEventListener('click', () => elements.tasksFile.click());
      elements.tasksFile.addEventListener('change', loadTasksFromFile);
      elements.issuesTab.addEventListener('click', () => switchSidebarView('issues'));
      elements.tasksTab.addEventListener('click', () => switchSidebarView('tasks'));
      elements.pipelineTab?.addEventListener('click', () => switchSidebarView('pipeline'));
      elements.agentTab?.addEventListener('click', () => switchSidebarView('agent'));
      elements.aiTab?.addEventListener('click', () => switchSidebarView('ai'));
      elements.metricsTab?.addEventListener('click', () => switchSidebarView('metrics'));
      
      // Export button (P11-T017)
      const exportBtn = document.getElementById('exportBtn');
      if (exportBtn) exportBtn.addEventListener('click', showExportDialog);
      const exportCancelBtn = document.getElementById('exportCancelBtn');
      if (exportCancelBtn) exportCancelBtn.addEventListener('click', hideExportDialog);
      const exportDialogCloseBtn = document.getElementById('exportDialogCloseBtn');
      if (exportDialogCloseBtn) exportDialogCloseBtn.addEventListener('click', hideExportDialog);
      document.querySelectorAll('.export-format-btn').forEach(btn => {
        btn.addEventListener('click', () => exportIssues(btn.dataset.format));
      });
      // Close export dialog on overlay click
      const exportDialog = document.getElementById('exportDialog');
      if (exportDialog) {
        exportDialog.addEventListener('click', (e) => {
          if (e.target === exportDialog) hideExportDialog();
        });
      }
      
      // Metrics refresh button
      const metricsRefreshBtn = document.getElementById('metricsRefreshBtn');
      if (metricsRefreshBtn) metricsRefreshBtn.addEventListener('click', () => loadMetrics(true));
      elements.messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });

      // Auto-resize textarea
      elements.messageInput.addEventListener('input', () => {
        elements.messageInput.style.height = 'auto';
        elements.messageInput.style.height = elements.messageInput.scrollHeight + 'px';
      });

      renderIssues();
      updateStats();
      
      // Initialize filter listeners (P11-T011)
      setupFilterListeners();
      
      // Initialize search listeners (P11-T012)
      setupSearchListeners();
      
      // Initialize multi-selection listeners (P11-T013)
      setupMultiSelectionListeners();
      
      // Initialize WebSocket connection for real-time updates
      initializeWebSocket();
    }
    
    // ============================================================================
    // WebSocket Integration (P11-T010)
    // ============================================================================
    
    function initializeWebSocket() {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}`;
      
      try {
        state.websocket = new WebSocket(wsUrl);
        
        state.websocket.onopen = () => {
          state.websocketConnected = true;
          console.log('[WebSocket] Connected');
          updateConnectionStatus(true);
          
          // Request initial stats
          state.websocket.send(JSON.stringify({ type: 'getStats' }));
        };
        
        state.websocket.onclose = () => {
          state.websocketConnected = false;
          console.log('[WebSocket] Disconnected');
          updateConnectionStatus(false);
          
          // Attempt reconnection after 3 seconds
          setTimeout(() => {
            if (!state.websocketConnected) {
              console.log('[WebSocket] Attempting reconnection...');
              initializeWebSocket();
            }
          }, 3000);
        };
        
        state.websocket.onerror = (error) => {
          console.error('[WebSocket] Error:', error);
        };
        
        state.websocket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            handleWebSocketMessage(message);
          } catch (error) {
            console.error('[WebSocket] Failed to parse message:', error);
          }
        };
      } catch (error) {
        console.error('[WebSocket] Failed to initialize:', error);
      }
    }
    
    function handleWebSocketMessage(message) {
      switch (message.type) {
        case 'connected':
          console.log('[WebSocket] Server confirmed connection');
          break;
          
        case 'pong':
          // Heartbeat response
          break;
          
        case 'issuesLoaded':
          state.issues = (message.issues || []).map(normalizeIssue);
          state.selectedIssue = null;
          renderIssues();
          updateStats();
          elements.sidebarStatus.textContent = `${message.count} issue(s) found.`;
          break;
          
        case 'fixGenerating':
          addAssistantMessage(`⏳ Generating fix for issue...`);
          break;
          
        case 'fixGenerated':
          handleFixGenerated(message);
          break;
          
        case 'fixApplying':
          addAssistantMessage(`⏳ Applying fix to file...`);
          break;
          
        case 'fixApplied':
          state.stats.fixed++;
          updateStats();
          addAssistantMessage(
            `✅ Fix applied to <code>${escapeHtml(message.filePath)}</code><br>` +
            `Backup: <code>${escapeHtml(message.backupPath)}</code>`
          );
          // Refresh issues
          state.websocket.send(JSON.stringify({ type: 'loadIssues' }));
          break;
          
        case 'fixError':
          addAssistantMessage(`❌ Fix error: ${escapeHtml(message.error)}`);
          break;
          
        case 'stats':
          if (message.stats) {
            state.stats = { ...state.stats, ...message.stats };
            updateStats();
          }
          break;
          
        case 'issueExplained':
          if (message.explanation) {
            addAssistantMessage(
              `💡 <strong>${escapeHtml(message.explanation.title)}</strong><br><br>` +
              escapeHtml(message.explanation.description) + '<br><br>' +
              (message.explanation.fix ? `<strong>Fix:</strong> ${escapeHtml(message.explanation.fix)}` : '')
            );
          }
          break;
          
        // Pipeline events (P11-T018)
        case 'pipeline:started':
          handlePipelineStarted(message);
          break;
          
        case 'pipeline:progress':
          handlePipelineProgress(message);
          break;
          
        case 'pipeline:completed':
          handlePipelineCompleted(message);
          break;
          
        case 'pipeline:failed':
          handlePipelineFailed(message);
          break;
          
        // Agent events (P11-T019)
        case 'agent:started':
          handleAgentStarted(message);
          break;
          
        case 'agent:progress':
          handleAgentProgress(message);
          break;
          
        case 'agent:completed':
          handleAgentCompleted(message);
          break;
          
        case 'agent:failed':
          handleAgentFailed(message);
          break;
          
        case 'agent:approval_required':
          handleAgentApprovalRequired(message);
          break;
          
        default:
          console.log('[WebSocket] Unhandled message type:', message.type);
      }
    }
    
    function updateConnectionStatus(connected) {
      const statusEl = document.getElementById('connectionStatus');
      if (statusEl) {
        statusEl.className = connected ? 'connected' : 'disconnected';
        statusEl.textContent = connected ? '● Connected' : '○ Disconnected';
      }
    }
    
    function handleFixGenerated(message) {
      const issue = state.issues.find(i => i.id === message.issueId);
      const confidence = message.confidence || 0;
      const confidenceClass = confidence > 0.8 ? 'high' : confidence > 0.6 ? 'medium' : 'low';
      
      addAssistantMessage(
        `✅ Fix generated successfully!
        <div class="fix-preview">
          <div class="fix-preview-header">
            <span>Proposed Fix</span>
            <span class="confidence-badge confidence-${confidenceClass}">${Math.round(confidence * 100)}% confidence</span>
          </div>
          <div class="diff-view">
            <div class="diff-section">
              <h4>BEFORE</h4>
              <pre>${escapeHtml(message.originalCode || '')}</pre>
            </div>
            <div class="diff-section">
              <h4>AFTER</h4>
              <pre>${escapeHtml(message.fixedCode || '')}</pre>
            </div>
          </div>
        </div>`,
        [{
          text: '✓ Apply Fix',
          action: () => {
            state.websocket.send(JSON.stringify({
              type: 'applyFix',
              data: {
                issue,
                originalCode: message.originalCode,
                fixedCode: message.fixedCode
              }
            }));
          }
        }, {
          text: '✗ Reject',
          action: () => addAssistantMessage('Fix rejected. The code will remain unchanged.')
        }]
      );
    }
    
    // Pipeline event handlers
    function handlePipelineStarted(message) {
      state.pipelineState = {
        id: message.runId,
        pipeline: message.pipelineId,
        status: 'running',
        stages: [],
        startTime: Date.now()
      };
      
      addAssistantMessage(`🚀 Pipeline started: <strong>${escapeHtml(message.pipelineId)}</strong>`);
      updatePipelinePanel();
    }
    
    function handlePipelineProgress(message) {
      if (state.pipelineState) {
        state.pipelineState.currentStage = message.stage;
        state.pipelineState.stages.push({
          name: message.stage,
          status: message.status,
          timestamp: Date.now()
        });
        updatePipelinePanel();
      }
    }
    
    function handlePipelineCompleted(message) {
      if (state.pipelineState) {
        state.pipelineState.status = 'completed';
        state.pipelineState.endTime = Date.now();
        state.pipelineState.duration = state.pipelineState.endTime - state.pipelineState.startTime;
      }
      
      addAssistantMessage(`✅ Pipeline completed: <strong>${escapeHtml(message.pipelineId || '')}</strong> (${message.duration || 0}ms)`);
      updatePipelinePanel();
    }
    
    function handlePipelineFailed(message) {
      if (state.pipelineState) {
        state.pipelineState.status = 'failed';
        state.pipelineState.error = message.error;
      }
      
      addAssistantMessage(`❌ Pipeline failed: ${escapeHtml(message.error || 'Unknown error')}`);
      updatePipelinePanel();
    }
    
    // Agent event handlers
    function handleAgentStarted(message) {
      state.agentState = {
        id: message.workId,
        description: message.description,
        status: 'running',
        steps: [],
        startTime: Date.now()
      };
      
      addAssistantMessage(`🤖 Agent started: <strong>${escapeHtml(message.description || '')}</strong>`);
      updateAgentPanel();
    }
    
    function handleAgentProgress(message) {
      if (state.agentState) {
        state.agentState.currentStep = message.step;
        state.agentState.steps.push({
          description: message.step,
          status: message.status,
          timestamp: Date.now()
        });
        updateAgentPanel();
      }
    }
    
    function handleAgentCompleted(message) {
      if (state.agentState) {
        state.agentState.status = 'completed';
        state.agentState.endTime = Date.now();
        state.agentState.duration = state.agentState.endTime - state.agentState.startTime;
      }
      
      addAssistantMessage(`✅ Agent work completed!`);
      updateAgentPanel();
    }
    
    function handleAgentFailed(message) {
      if (state.agentState) {
        state.agentState.status = 'failed';
        state.agentState.error = message.error;
      }
      
      addAssistantMessage(`❌ Agent work failed: ${escapeHtml(message.error || 'Unknown error')}`);
      updateAgentPanel();
    }
    
    function handleAgentApprovalRequired(message) {
      if (state.agentState) {
        state.agentState.status = 'awaiting_approval';
        state.agentState.plan = message.plan;
      }
      
      addAssistantMessage(
        `⚠️ <strong>Approval Required</strong><br><br>` +
        `The agent wants to proceed with a high-risk operation.<br>` +
        `Affected files: ${message.plan?.affectedFiles?.length || 0}<br>` +
        `Risks: ${message.plan?.risks?.map(r => r.description).join(', ') || 'None'}`,
        [{
          text: '✓ Approve',
          action: () => approveAgentWork(message.workId)
        }, {
          text: '✗ Reject',
          action: () => addAssistantMessage('Agent work rejected.')
        }]
      );
      
      updateAgentPanel();
    }
    
    function approveAgentWork(workId) {
      // Send approval via HTTP API
      fetch(`http://localhost:3000/api/agent/${workId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      .then(response => response.json())
      .then(result => {
        if (result.success) {
          addAssistantMessage('✅ Agent work approved. Execution will continue.');
        } else {
          addAssistantMessage(`❌ Failed to approve: ${result.error}`);
        }
      })
      .catch(error => {
        addAssistantMessage(`❌ Approval failed: ${error.message}`);
      });
    }
    
    function updatePipelinePanel() {
      const panel = document.getElementById('pipelinePanel');
      if (!panel || !state.pipelineState) return;
      
      const pipeline = state.pipelineState;
      const statusIcon = {
        'running': '⏳',
        'completed': '✅',
        'failed': '❌'
      }[pipeline.status] || '📋';
      
      panel.innerHTML = `
        <div class="pipeline-status">
          <h3>${statusIcon} Pipeline: ${escapeHtml(pipeline.pipeline)}</h3>
          <p>Status: ${escapeHtml(pipeline.status)}</p>
          ${pipeline.currentStage ? `<p>Current: ${escapeHtml(pipeline.currentStage)}</p>` : ''}
          ${pipeline.duration ? `<p>Duration: ${pipeline.duration}ms</p>` : ''}
          ${pipeline.error ? `<p class="error">Error: ${escapeHtml(pipeline.error)}</p>` : ''}
        </div>
      `;
    }
    
    function updateAgentPanel() {
      const panel = document.getElementById('agentPanel');
      if (!panel || !state.agentState) return;
      
      const agent = state.agentState;
      const statusIcon = {
        'running': '⏳',
        'completed': '✅',
        'failed': '❌',
        'awaiting_approval': '⚠️'
      }[agent.status] || '📋';
      
      panel.innerHTML = `
        <div class="agent-status">
          <h3>${statusIcon} Agent Work</h3>
          <p>${escapeHtml(agent.description || '')}</p>
          <p>Status: ${escapeHtml(agent.status)}</p>
          ${agent.currentStep ? `<p>Current: ${escapeHtml(agent.currentStep)}</p>` : ''}
          ${agent.duration ? `<p>Duration: ${agent.duration}ms</p>` : ''}
          ${agent.error ? `<p class="error">Error: ${escapeHtml(agent.error)}</p>` : ''}
        </div>
      `;
    }
    
    // ============================================================================
    // Pipeline Panel Functions (P11-T018)
    // ============================================================================
    
    const pipelineState = {
      pipelines: [],
      selectedPipeline: null,
      executions: [],
      currentExecution: null,
      connected: false
    };
    
    function initializePipelinePanel() {
      // Load available pipelines
      loadPipelines();
      
      // Set up event listeners
      document.getElementById('pipelineRefreshBtn')?.addEventListener('click', loadPipelines);
      document.getElementById('pipelineRunBtn')?.addEventListener('click', runPipeline);
      document.getElementById('pipelineCancelBtn')?.addEventListener('click', cancelPipeline);
      document.getElementById('pipelineSelect')?.addEventListener('change', onPipelineSelect);
      document.getElementById('pipelineHistoryBtn')?.addEventListener('click', showPipelineHistory);
      document.getElementById('closePipelineDetails')?.addEventListener('click', closePipelineDetails);
      document.getElementById('execReplayBtn')?.addEventListener('click', replayExecution);
      document.getElementById('execExportBtn')?.addEventListener('click', exportExecutionReport);
    }
    
    async function loadPipelines() {
      try {
        const response = await fetch('http://localhost:3000/api/pipelines');
        const data = await response.json();
        
        pipelineState.pipelines = data.pipelines || [];
        renderPipelineSelect();
        
        // Load recent executions
        await loadPipelineHistory();
      } catch (error) {
        console.error('Failed to load pipelines:', error);
        document.getElementById('pipelineSelect').innerHTML = '<option value="">Error loading pipelines</option>';
      }
    }
    
    function renderPipelineSelect() {
      const select = document.getElementById('pipelineSelect');
      if (!select) return;
      
      select.innerHTML = '<option value="">-- Select a pipeline --</option>' +
        pipelineState.pipelines.map(p => `<option value="${p.id || p.name}">${p.name}</option>`).join('');
    }
    
    async function onPipelineSelect(e) {
      const pipelineId = e.target.value;
      if (!pipelineId) {
        document.getElementById('pipelineInfo').style.display = 'none';
        document.getElementById('pipelineRunBtn').disabled = true;
        return;
      }
      
      try {
        const response = await fetch(`http://localhost:3000/api/pipelines/${pipelineId}`);
        const data = await response.json();
        
        pipelineState.selectedPipeline = data;
        renderPipelineInfo(data);
        document.getElementById('pipelineRunBtn').disabled = false;
      } catch (error) {
        console.error('Failed to load pipeline info:', error);
      }
    }
    
    function renderPipelineInfo(pipeline) {
      const infoEl = document.getElementById('pipelineInfo');
      if (!infoEl) return;
      
      document.getElementById('pipelineName').textContent = pipeline.name;
      document.getElementById('pipelineVersion').textContent = pipeline.version || 'v1.0';
      document.getElementById('pipelineDescription').textContent = pipeline.description || 'No description';
      document.getElementById('pipelineSteps').textContent = pipeline.steps?.length || 0;
      document.getElementById('pipelineTimeout').textContent = formatDuration(pipeline.timeout || 1800000);
      
      // Render steps
      renderPipelineSteps(pipeline.steps || []);
      
      infoEl.style.display = 'block';
    }
    
    function renderPipelineSteps(steps) {
      const content = document.getElementById('pipelineStepsContent');
      if (!content) return;
      
      if (steps.length === 0) {
        content.innerHTML = '<div class="empty-state small"><p>No steps defined</p></div>';
        return;
      }
      
      content.innerHTML = steps.map((step, i) => `
        <div class="step-item pending" data-step="${i}">
          <span class="step-icon">⏸️</span>
          <span class="step-name">${escapeHtml(step.name || step.id || `Step ${i + 1}`)}</span>
          <span class="step-duration">-</span>
        </div>
      `).join('');
      
      document.getElementById('stepsSummary').textContent = `${steps.length} total`;
    }
    
    async function runPipeline() {
      const pipelineId = document.getElementById('pipelineSelect').value;
      if (!pipelineId) return;
      
      const dryRun = document.getElementById('pipelineDryRun')?.checked || false;
      const autoApprove = document.getElementById('pipelineAutoApprove')?.checked || false;
      
      // Show progress
      document.getElementById('pipelineProgress').style.display = 'block';
      document.getElementById('pipelineExecStatus').textContent = 'Starting...';
      document.getElementById('pipelineProgressBar').style.width = '0%';
      document.getElementById('pipelineRunBtn').disabled = true;
      document.getElementById('pipelineCancelBtn').disabled = false;
      
      try {
        const response = await fetch(`http://localhost:3000/api/pipelines/${pipelineId}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dryRun, autoApprove })
        });
        
        const result = await response.json();
        
        if (result.executionId) {
          pipelineState.currentExecution = result.executionId;
          updateExecutionProgress(result);
          addAssistantMessage(`🚀 Pipeline <strong>${escapeHtml(pipelineId)}</strong> started. Execution ID: <code>${result.executionId}</code>`);
        }
      } catch (error) {
        console.error('Failed to run pipeline:', error);
        addAssistantMessage(`❌ Failed to start pipeline: ${error.message}`);
        document.getElementById('pipelineRunBtn').disabled = false;
        document.getElementById('pipelineCancelBtn').disabled = true;
      }
    }
    
    async function cancelPipeline() {
      if (!pipelineState.currentExecution) return;
      
      try {
        const response = await fetch(`http://localhost:3000/api/pipelines/executions/${pipelineState.currentExecution}`, {
          method: 'DELETE'
        });
        
        if (response.ok) {
          addAssistantMessage('⏹️ Pipeline execution cancelled');
          document.getElementById('pipelineExecStatus').textContent = 'Cancelled';
          document.getElementById('pipelineCancelBtn').disabled = true;
          document.getElementById('pipelineRunBtn').disabled = false;
        }
      } catch (error) {
        console.error('Failed to cancel pipeline:', error);
      }
    }
    
    function updateExecutionProgress(data) {
      const status = document.getElementById('pipelineExecStatus');
      const bar = document.getElementById('pipelineProgressBar');
      const text = document.getElementById('pipelineProgressText');
      const elapsed = document.getElementById('pipelineElapsed');
      
      if (status) status.textContent = data.status || 'Running';
      if (bar) bar.style.width = `${data.progress || 0}%`;
      if (text) text.textContent = `${data.completedSteps || 0} / ${data.totalSteps || 0} steps completed`;
      if (elapsed && data.startTime) {
        const elapsedMs = Date.now() - new Date(data.startTime).getTime();
        elapsed.textContent = formatDuration(elapsedMs);
      }
      
      // Update step statuses
      if (data.steps) {
        data.steps.forEach((step, i) => {
          const stepEl = document.querySelector(`[data-step="${i}"]`);
          if (stepEl) {
            stepEl.className = `step-item ${step.status}`;
            stepEl.querySelector('.step-icon').textContent = getStepIcon(step.status);
            if (step.duration) {
              stepEl.querySelector('.step-duration').textContent = formatDuration(step.duration);
            }
          }
        });
      }
      
      // Update buttons based on status
      if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
        document.getElementById('pipelineRunBtn').disabled = false;
        document.getElementById('pipelineCancelBtn').disabled = true;
      }
    }
    
    function getStepIcon(status) {
      const icons = {
        pending: '⏸️',
        running: '⏳',
        completed: '✅',
        failed: '❌',
        skipped: '⏭️'
      };
      return icons[status] || '⏸️';
    }
    
    async function loadPipelineHistory() {
      try {
        const response = await fetch('http://localhost:3000/api/pipelines/executions?limit=50');
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
        
        pipelineState.executions = data.executions || data.data || [];
        renderPipelineHistory();
        return true;
      } catch (error) {
        console.error('Failed to load pipeline history:', error);
        addAssistantMessage(`Failed to load pipeline history: ${escapeHtml(error.message)}`);
        return false;
      }
    }
    
    function renderPipelineHistory() {
      const history = document.getElementById('pipelineHistory');
      if (!history) return;
      
      const recent = pipelineState.executions.slice(0, 5);
      
      if (recent.length === 0) {
        history.innerHTML = '<div class="empty-state small"><p>No recent executions</p></div>';
        return;
      }
      
      history.innerHTML = recent.map(exec => {
        const id = exec.id || exec.runId;
        const pipeline = exec.pipeline || exec.pipelineName || exec.pipelineId || 'Unknown pipeline';
        const status = String(exec.status || 'unknown').toLowerCase();
        const started = exec.startTime || exec.started;
        return `
        <div class="history-item" data-exec-id="${escapeHtml(id || '')}">
          <div class="history-info">
            <span class="history-icon">${status === 'completed' ? '✅' : status === 'failed' ? '❌' : '⏳'}</span>
            <div>
              <div class="history-name">${escapeHtml(pipeline)}</div>
              <div class="history-time">${started ? formatTimeAgo(started) : 'Unknown time'}</div>
            </div>
          </div>
          <span class="history-status ${escapeHtml(status)}">${escapeHtml(status)}</span>
        </div>
      `;
      }).join('');
      
      // Add click handlers
      history.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', () => showExecutionDetails(item.dataset.execId));
      });
    }
    
    async function showExecutionDetails(execId) {
      try {
        const response = await fetch(`http://localhost:3000/api/pipelines/executions/${execId}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || payload.error || `Request failed (${response.status})`);
        const data = payload.data || payload;
        
        const details = document.getElementById('pipelineExecDetails');
        if (!details) return;
        
        document.getElementById('execId').textContent = data.id || data.runId || execId;
        const started = data.startTime || data.started;
        document.getElementById('execStart').textContent = started ? new Date(started).toLocaleString() : '-';
        document.getElementById('execDuration').textContent = data.duration ? formatDuration(data.duration) : '-';
        document.getElementById('execStatus').textContent = data.status;
        document.getElementById('execIssuesFound').textContent = data.issuesFound || 0;
        document.getElementById('execIssuesFixed').textContent = data.issuesFixed || 0;
        
        details.style.display = 'block';
      } catch (error) {
        console.error('Failed to load execution details:', error);
        addAssistantMessage(`Failed to load execution details: ${escapeHtml(error.message)}`);
      }
    }
    
    function closePipelineDetails() {
      document.getElementById('pipelineExecDetails').style.display = 'none';
    }
    
    async function showPipelineHistory() {
      if (!await loadPipelineHistory()) return;
      if (pipelineState.executions.length === 0) {
        addAssistantMessage('No pipeline executions have been recorded yet.');
        return;
      }

      const items = pipelineState.executions.map(exec => {
        const pipeline = exec.pipeline || exec.pipelineName || exec.pipelineId || 'Unknown pipeline';
        const status = String(exec.status || 'unknown').toLowerCase();
        const started = exec.startTime || exec.started;
        const timestamp = started ? formatTimeAgo(started) : 'Unknown time';
        return `<li><strong>${escapeHtml(pipeline)}</strong> — ${escapeHtml(status)} — ${escapeHtml(timestamp)}</li>`;
      }).join('');
      addAssistantMessage(`<strong>Pipeline execution history</strong><ul>${items}</ul>`);
    }
    
    async function replayExecution() {
      const execId = document.getElementById('execId').textContent;
      try {
        const response = await fetch(`http://localhost:3000/api/pipelines/executions/${encodeURIComponent(execId)}/replay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || payload.error || `Request failed (${response.status})`);
        const preview = payload.data || payload;
        addAssistantMessage(
          `Replay preview for ${escapeHtml(preview.pipelineId || execId)}: ` +
          `${escapeHtml(preview.message || 'Execution details loaded.')} ` +
          'No new execution was started; use the CLI or SDK for a full replay.'
        );
      } catch (error) {
        console.error('Failed to preview pipeline replay:', error);
        addAssistantMessage(`Failed to preview pipeline replay: ${escapeHtml(error.message)}`);
      }
    }
    
    async function exportExecutionReport() {
      const execId = document.getElementById('execId').textContent;
      try {
        const response = await fetch(`http://localhost:3000/api/pipelines/executions/${encodeURIComponent(execId)}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || payload.error || `Request failed (${response.status})`);
        const data = payload.data || payload;
        const report = {
          generatedAt: new Date().toISOString(),
          execution: {
            id: data.id || data.runId || execId,
            pipeline: data.pipeline || data.pipelineName || data.pipelineId,
            status: data.status,
            started: data.started || data.startTime,
            completed: data.completed,
            duration: data.duration,
            error: data.error || null
          }
        };
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `aqt-pipeline-${execId.replace(/[^\w.-]/g, '_')}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
        addAssistantMessage(`Downloaded the execution summary for ${escapeHtml(execId)}.`);
      } catch (error) {
        console.error('Failed to export pipeline report:', error);
        addAssistantMessage(`Failed to export pipeline report: ${escapeHtml(error.message)}`);
      }
    }
    
    // ============================================================================
    // Agent Panel Functions (P11-T019)
    // ============================================================================
    
    const agentPanelState = {
      agents: [],
      selectedAgent: null,
      stats: {
        completed: 0,
        tasksCompleted: 0,
        fixesApplied: 0
      }
    };
    
    function initializeAgentPanel() {
      // Load active agents
      loadActiveAgents();
      
      // Set up event listeners
      document.getElementById('agentStartBtn')?.addEventListener('click', showAgentStartForm);
      document.getElementById('agentRefreshBtn')?.addEventListener('click', loadActiveAgents);
      document.getElementById('agentConfirmBtn')?.addEventListener('click', startAgent);
      document.getElementById('agentCancelStartBtn')?.addEventListener('click', hideAgentStartForm);
      document.getElementById('closeAgentDetails')?.addEventListener('click', closeAgentDetails);
      document.getElementById('agentPauseBtn')?.addEventListener('click', pauseAgent);
      document.getElementById('agentResumeBtn')?.addEventListener('click', resumeAgent);
      document.getElementById('agentCancelDetailBtn')?.addEventListener('click', cancelAgent);
      document.getElementById('agentHistoryBtn')?.addEventListener('click', showAgentHistory);
      document.getElementById('agentLogsExpandBtn')?.addEventListener('click', expandAgentLogs);
    }
    
    async function loadActiveAgents() {
      try {
        const response = await fetch('http://localhost:3000/api/agent');
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
        
        agentPanelState.agents = data.agents || data.data || [];
        renderActiveAgents();
        updateAgentStats();
        return true;
      } catch (error) {
        console.error('Failed to load agents:', error);
        addAssistantMessage(`Failed to load agent history: ${escapeHtml(error.message)}`);
        return false;
      }
    }
    
    function renderActiveAgents() {
      const list = document.getElementById('activeAgentsList');
      const count = document.getElementById('activeAgentsCount');
      
      if (!list) return;
      
      const active = agentPanelState.agents.filter(a => a.status === 'running' || a.status === 'paused');
      if (count) count.textContent = active.length;
      
      if (active.length === 0) {
        list.innerHTML = '<div class="empty-state small"><p>No active agents</p></div>';
        return;
      }
      
      list.innerHTML = active.map(agent => `
        <div class="agent-card" data-agent-id="${agent.id}">
          <div class="agent-card-header">
            <span class="agent-card-id">${agent.id.slice(0, 8)}</span>
            <span class="agent-card-status ${agent.status}">${escapeHtml(agent.status)}</span>
          </div>
          <div class="agent-card-info">
            <span>Type: ${escapeHtml(agent.type || 'autonomous')}</span>
            <span>Progress: ${agent.progress || 0}%</span>
          </div>
        </div>
      `).join('');
      
      // Add click handlers
      list.querySelectorAll('.agent-card').forEach(card => {
        card.addEventListener('click', () => showAgentDetails(card.dataset.agentId));
      });
    }
    
    async function showAgentDetails(agentId) {
      try {
        const response = await fetch(`http://localhost:3000/api/agent/${agentId}`);
        const data = await response.json();
        
        agentPanelState.selectedAgent = data;
        renderAgentDetails(data);
        document.getElementById('agentDetails').style.display = 'block';
      } catch (error) {
        console.error('Failed to load agent details:', error);
      }
    }
    
    function renderAgentDetails(agent) {
      document.getElementById('agentDetailId').textContent = agent.id;
      document.getElementById('agentDetailType').textContent = agent.type || 'autonomous';
      document.getElementById('agentDetailStatus').textContent = agent.status;
      document.getElementById('agentDetailProgress').textContent = `${agent.progress || 0}%`;
      document.getElementById('agentDetailStep').textContent = agent.currentStep || '-';
      
      // Update progress bar
      document.getElementById('agentProgressBar').style.width = `${agent.progress || 0}%`;
      document.getElementById('agentProgressText').textContent = `${agent.progress || 0}%`;
      document.getElementById('agentIterationText').textContent = `Iteration ${agent.iteration || 0}/${agent.maxIterations || 10}`;
      
      // Update buttons
      const pauseBtn = document.getElementById('agentPauseBtn');
      const resumeBtn = document.getElementById('agentResumeBtn');
      
      if (agent.status === 'paused') {
        pauseBtn.disabled = true;
        resumeBtn.disabled = false;
      } else if (agent.status === 'running') {
        pauseBtn.disabled = false;
        resumeBtn.disabled = true;
      } else {
        pauseBtn.disabled = true;
        resumeBtn.disabled = true;
      }
      
      // Show pending approvals if any
      if (agent.pendingApprovals && agent.pendingApprovals.length > 0) {
        renderPendingApprovals(agent.pendingApprovals);
        document.getElementById('pendingApprovals').style.display = 'block';
      } else {
        document.getElementById('pendingApprovals').style.display = 'none';
      }
      
      // Load recent logs
      loadAgentLogs(agent.id);
    }
    
    function renderPendingApprovals(approvals) {
      const list = document.getElementById('approvalsList');
      if (!list) return;
      
      list.innerHTML = approvals.map((approval, i) => `
        <div class="approval-item">
          <div>${escapeHtml(approval.description || approval.action)}</div>
          <div class="approval-actions">
            <button class="approval-btn approve" data-approval="${i}">✓ Approve</button>
            <button class="approval-btn reject" data-approval="${i}">✗ Reject</button>
          </div>
        </div>
      `).join('');
      
      // Add click handlers
      list.querySelectorAll('.approval-btn.approve').forEach(btn => {
        btn.addEventListener('click', () => approveAgentOperation(agentPanelState.selectedAgent.id, btn.dataset.approval));
      });
      list.querySelectorAll('.approval-btn.reject').forEach(btn => {
        btn.addEventListener('click', () => rejectAgentOperation(agentPanelState.selectedAgent.id, btn.dataset.approval));
      });
    }
    
    async function loadAgentLogs(agentId) {
      try {
        const response = await fetch(`http://localhost:3000/api/agent/${agentId}/logs?limit=20`);
        const data = await response.json();
        
        const content = document.getElementById('agentLogsContent');
        if (!content) return;
        
        if (!data.logs || data.logs.length === 0) {
          content.innerHTML = '<div class="log-entry">No logs available</div>';
          return;
        }
        
        content.innerHTML = data.logs.map(log => `
          <div class="log-entry ${log.level || 'info'}">[${new Date(log.timestamp).toLocaleTimeString()}] ${escapeHtml(log.message)}</div>
        `).join('');
      } catch (error) {
        console.error('Failed to load agent logs:', error);
      }
    }
    
    function showAgentStartForm() {
      document.getElementById('agentStartForm').style.display = 'block';
      document.getElementById('agentStartBtn').style.display = 'none';
    }
    
    function hideAgentStartForm() {
      document.getElementById('agentStartForm').style.display = 'none';
      document.getElementById('agentStartBtn').style.display = 'inline-flex';
    }
    
    async function startAgent() {
      const type = document.getElementById('agentType').value;
      const goal = document.getElementById('agentGoal').value.trim();
      const maxIterations = document.getElementById('agentMaxIterations').value;
      const autoApprove = document.getElementById('agentAutoApprove')?.checked || false;
      
      if (!goal) {
        alert('Please enter a goal for the agent');
        return;
      }
      
      try {
        const response = await fetch('http://localhost:3000/api/agent/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, goal, maxIterations: parseInt(maxIterations), autoApprove })
        });
        
        const result = await response.json();
        
        if (result.workId) {
          addAssistantMessage(`🤖 Agent started with ID: <code>${result.workId}</code>`);
          hideAgentStartForm();
          loadActiveAgents();
          document.getElementById('agentGoal').value = '';
        }
      } catch (error) {
        console.error('Failed to start agent:', error);
        addAssistantMessage(`❌ Failed to start agent: ${error.message}`);
      }
    }
    
    async function pauseAgent() {
      if (!agentPanelState.selectedAgent) return;
      
      try {
        const response = await fetch(`http://localhost:3000/api/agent/${agentPanelState.selectedAgent.id}/pause`, {
          method: 'POST'
        });
        
        if (response.ok) {
          addAssistantMessage('⏸️ Agent paused');
          showAgentDetails(agentPanelState.selectedAgent.id);
        }
      } catch (error) {
        console.error('Failed to pause agent:', error);
      }
    }
    
    async function resumeAgent() {
      if (!agentPanelState.selectedAgent) return;
      
      try {
        const response = await fetch(`http://localhost:3000/api/agent/${agentPanelState.selectedAgent.id}/resume`, {
          method: 'POST'
        });
        
        if (response.ok) {
          addAssistantMessage('▶️ Agent resumed');
          showAgentDetails(agentPanelState.selectedAgent.id);
        }
      } catch (error) {
        console.error('Failed to resume agent:', error);
      }
    }
    
    async function cancelAgent() {
      if (!agentPanelState.selectedAgent) return;
      
      if (!confirm('Are you sure you want to cancel this agent?')) return;
      
      try {
        const response = await fetch(`http://localhost:3000/api/agent/${agentPanelState.selectedAgent.id}`, {
          method: 'DELETE'
        });
        
        if (response.ok) {
          addAssistantMessage('⏹️ Agent cancelled');
          document.getElementById('agentDetails').style.display = 'none';
          loadActiveAgents();
        }
      } catch (error) {
        console.error('Failed to cancel agent:', error);
      }
    }
    
    async function approveAgentOperation(agentId, approvalIndex) {
      try {
        const response = await fetch(`http://localhost:3000/api/agent/${agentId}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approvalIndex: parseInt(approvalIndex) })
        });
        
        if (response.ok) {
          addAssistantMessage('✅ Operation approved');
          showAgentDetails(agentId);
        }
      } catch (error) {
        console.error('Failed to approve operation:', error);
      }
    }
    
    async function rejectAgentOperation(agentId, approvalIndex) {
      try {
        const response = await fetch(`http://localhost:3000/api/agent/${agentId}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approvalIndex: parseInt(approvalIndex) })
        });
        
        if (response.ok) {
          addAssistantMessage('❌ Operation rejected');
          showAgentDetails(agentId);
        }
      } catch (error) {
        console.error('Failed to reject operation:', error);
      }
    }
    
    function closeAgentDetails() {
      document.getElementById('agentDetails').style.display = 'none';
    }
    
    async function showAgentHistory() {
      if (!await loadActiveAgents()) return;
      if (agentPanelState.agents.length === 0) {
        addAssistantMessage('No agent work has been recorded yet.');
        return;
      }

      const items = agentPanelState.agents.map(agent => {
        const id = agent.id || 'Unknown agent';
        const status = String(agent.status || 'unknown').toLowerCase();
        const started = agent.started || agent.createdAt;
        const timestamp = started ? formatTimeAgo(started) : 'Unknown time';
        return `<li><strong>${escapeHtml(id)}</strong> — ${escapeHtml(status)} — ` +
          `${escapeHtml(agent.description || 'No description')} — ${escapeHtml(timestamp)}</li>`;
      }).join('');
      addAssistantMessage(`<strong>Agent work history</strong><ul>${items}</ul>`);
    }
    
    function expandAgentLogs() {
      // Toggle expanded view for logs
      const content = document.getElementById('agentLogsContent');
      if (content) {
        content.style.maxHeight = content.style.maxHeight === '300px' ? '120px' : '300px';
      }
    }
    
    function updateAgentStats() {
      document.getElementById('agentsCompleted').textContent = agentPanelState.stats.completed;
      document.getElementById('agentsTasksCompleted').textContent = agentPanelState.stats.tasksCompleted;
      document.getElementById('agentsFixesApplied').textContent = agentPanelState.stats.fixesApplied;
    }
    
    // ============================================================================
    // Utility Functions
    // ============================================================================
    
    function formatDuration(ms) {
      if (!ms) return '-';
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      
      if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
      } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
      } else {
        return `${seconds}s`;
      }
    }
    
    function formatTimeAgo(date) {
      const now = new Date();
      const then = new Date(date);
      const diffMs = now - then;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);
      
      if (diffDays > 0) return `${diffDays}d ago`;
      if (diffHours > 0) return `${diffHours}h ago`;
      if (diffMins > 0) return `${diffMins}m ago`;
      return 'just now';
    }
    function renderIssues() {
      elements.issueCount.textContent = state.issues.length;
      
      // Apply filters
      const filtered = applyFilters(state.issues);
      state.filteredIssues = filtered;
      
      // Then apply search if active
      renderSearchResults();
    }

    function switchSidebarView(view) {
      state.activeSidebarView = view;
      
      // Update tab active states
      document.querySelectorAll('.sidebar-tab').forEach(tab => {
        tab.classList.remove('active');
        tab.setAttribute('aria-selected', 'false');
      });
      
      const tabMap = {
        'issues': 'issuesTab',
        'tasks': 'tasksTab',
        'pipeline': 'pipelineTab',
        'agent': 'agentTab',
        'ai': 'aiTab',
        'metrics': 'metricsTab'
      };
      
      const activeTab = document.getElementById(tabMap[view]);
      if (activeTab) {
        activeTab.classList.add('active');
        activeTab.setAttribute('aria-selected', 'true');
      }
      
      // Show/hide filters container based on view
      const filtersContainer = document.getElementById('filtersContainer');
      const searchContainer = document.getElementById('searchContainer');
      if (view === 'issues') {
        filtersContainer.style.display = 'block';
        searchContainer.style.display = 'block';
      } else {
        filtersContainer.style.display = 'none';
        searchContainer.style.display = 'none';
      }
      
      // Hide all panels first
      elements.issuesList.style.display = 'none';
      document.getElementById('aiPanel').style.display = 'none';
      document.getElementById('pipelinePanel').style.display = 'none';
      document.getElementById('agentPanel').style.display = 'none';
      document.getElementById('metricsPanel').style.display = 'none';
      
      // Show the appropriate panel
      switch (view) {
        case 'issues':
          elements.issuesList.style.display = 'block';
          renderIssues();
          break;
        case 'tasks':
          elements.issuesList.style.display = 'block';
          renderTasks();
          break;
        case 'pipeline':
          document.getElementById('pipelinePanel').style.display = 'block';
          initializePipelinePanel();
          break;
        case 'agent':
          document.getElementById('agentPanel').style.display = 'block';
          initializeAgentPanel();
          break;
        case 'ai':
          document.getElementById('aiPanel').style.display = 'block';
          switchAIForm('code');
          break;
        case 'metrics':
          document.getElementById('metricsPanel').style.display = 'block';
          initializeMetricsPanel();
          break;
      }
    }

    // ============================================================================
    // Issue Filtering (P11-T011)
    // ============================================================================

    function applyFilters(issues) {
      return issues.filter(issue => {
        // Severity filter
        if (state.filters.severity && issue.severity !== state.filters.severity) {
          return false;
        }
        
        // Category filter
        if (state.filters.category && issue.category !== state.filters.category) {
          return false;
        }
        
        // File filter (substring match, case-insensitive)
        if (state.filters.file) {
          if (!issue.file || !issue.file.toLowerCase().includes(state.filters.file.toLowerCase())) {
            return false;
          }
        }
        
        return true;
      });
    }

    function setupFilterListeners() {
      const severityFilter = document.getElementById('severityFilter');
      const categoryFilter = document.getElementById('categoryFilter');
      const fileFilter = document.getElementById('fileFilter');
      const clearFiltersBtn = document.getElementById('clearFiltersBtn');
      
      if (severityFilter) {
        severityFilter.addEventListener('change', (e) => {
          state.filters.severity = e.target.value || null;
          renderIssues();
        });
      }
      
      if (categoryFilter) {
        categoryFilter.addEventListener('change', (e) => {
          state.filters.category = e.target.value || null;
          renderIssues();
        });
      }
      
      if (fileFilter) {
        fileFilter.addEventListener('input', (e) => {
          state.filters.file = e.target.value || null;
          renderIssues();
        });
      }
      
      if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', () => {
          state.filters = {
            severity: null,
            category: null,
            file: null
          };
          
          if (severityFilter) severityFilter.value = '';
          if (categoryFilter) categoryFilter.value = '';
          if (fileFilter) fileFilter.value = '';
          
          renderIssues();
        });
      }
    }

    // ============================================================================
    // Search Functionality (P11-T012)
    // ============================================================================

    function searchIssues(query) {
      if (!query || query.trim().length === 0) {
        state.searchQuery = '';
        state.searchResults = [];
        return state.filteredIssues;
      }

      const queryLower = query.toLowerCase();
      state.searchQuery = query;

      state.searchResults = state.filteredIssues.filter(issue => {
        // Search across message, file, and ruleId
        const message = (issue.message || '').toLowerCase();
        const file = (issue.file || '').toLowerCase();
        const ruleId = (issue.ruleId || issue.rule || '').toLowerCase();

        return message.includes(queryLower) || 
               file.includes(queryLower) || 
               ruleId.includes(queryLower);
      });

      return state.searchResults;
    }

    function highlightSearchMatches(text, query) {
      if (!query || query.trim().length === 0) return escapeHtml(text);

      const queryLower = query.toLowerCase();
      const textLower = text.toLowerCase();
      const parts = [];
      let lastIndex = 0;

      let index = textLower.indexOf(queryLower);
      while (index !== -1) {
        if (index > lastIndex) {
          parts.push({ text: text.substring(lastIndex, index), highlight: false });
        }
        parts.push({ text: text.substring(index, index + queryLower.length), highlight: true });
        lastIndex = index + queryLower.length;
        index = textLower.indexOf(queryLower, lastIndex);
      }

      if (lastIndex < text.length) {
        parts.push({ text: text.substring(lastIndex), highlight: false });
      }

      return parts.map(part => 
        part.highlight ? `<mark>${escapeHtml(part.text)}</mark>` : escapeHtml(part.text)
      ).join('');
    }

    function renderSearchResults() {
      const results = state.searchQuery ? searchIssues(state.searchQuery) : state.filteredIssues;
      elements.issueCount.textContent = state.issues.length;

      if (results.length === 0) {
        let emptyMessage = 'No live issues';
        let emptyDescription = 'Run project analysis to load findings.';

        if (state.issues.length > 0 && state.searchQuery) {
          emptyMessage = 'No search results';
          emptyDescription = `No issues match "${state.searchQuery}". Try different search terms.`;
        } else if (state.issues.length > 0 && Object.values(state.filters).some(f => f !== null)) {
          emptyMessage = 'No issues match filters';
          emptyDescription = 'Try adjusting your filter criteria.';
        }

        elements.issuesList.innerHTML = `
          <div class="empty-state">
            <h3>${emptyMessage}</h3>
            <p>${emptyDescription}</p>
          </div>
        `;
        return;
      }

      elements.issuesList.innerHTML = results.map((issue, index) => `
        <div class="issue-card ${state.selectedIssue?.id === issue.id ? 'selected' : ''} ${state.selectedIssues.has(issue.id) ? 'multi-selected' : ''}" data-issue-id="${issue.id}" data-issue-index="${index}">
          <input type="checkbox" class="issue-checkbox" title="Select this issue" ${state.selectedIssues.has(issue.id) ? 'checked' : ''}>
          <span class="issue-severity severity-${issue.severity}">${escapeHtml(issue.severity)}</span>
          <div class="issue-title">${highlightSearchMatches(issue.message, state.searchQuery)}</div>
          <div class="issue-file">${highlightSearchMatches(issue.file, state.searchQuery)}:${escapeHtml(issue.line)}</div>
        </div>
      `).join('');

      elements.issuesList.querySelectorAll('[data-issue-id]').forEach((card, idx) => {
        const issueId = card.dataset.issueId;
        const issue = results[idx];
        
        // Checkbox listener for multi-selection
        const checkbox = card.querySelector('.issue-checkbox');
        if (checkbox) {
          checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            toggleIssueSelection(issueId);
          });
        }
        
        // Card click for single selection
        card.addEventListener('click', (e) => {
          if (e.target.type !== 'checkbox') {
            selectIssue(issueId);
          }
        });
      });

      updateBulkActionsBar();

      // Update search results info
      const searchResultsInfo = document.getElementById('searchResultsInfo');
      if (state.searchQuery && searchResultsInfo) {
        searchResultsInfo.textContent = `Found ${results.length} result${results.length !== 1 ? 's' : ''} for "${state.searchQuery}"`;
        searchResultsInfo.style.display = 'block';
      } else if (searchResultsInfo) {
        searchResultsInfo.style.display = 'none';
      }
    }

    function setupSearchListeners() {
      const searchInput = document.getElementById('searchInput');
      const searchClearBtn = document.getElementById('searchClearBtn');

      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          const query = e.target.value;
          state.searchQuery = query;

          // Show/hide clear button
          if (searchClearBtn) {
            searchClearBtn.style.display = query ? 'block' : 'none';
          }

          renderSearchResults();
        });

        searchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            searchInput.value = '';
            state.searchQuery = '';
            if (searchClearBtn) searchClearBtn.style.display = 'none';
            renderSearchResults();
          }
        });
      }

      if (searchClearBtn) {
        searchClearBtn.addEventListener('click', () => {
          if (searchInput) searchInput.value = '';
          state.searchQuery = '';
          searchClearBtn.style.display = 'none';
          renderSearchResults();
        });
      }
    }

    // ============================================================================
    // Multi-Issue Selection (P11-T013)
    // ============================================================================

    function toggleIssueSelection(issueId) {
      if (state.selectedIssues.has(issueId)) {
        state.selectedIssues.delete(issueId);
      } else {
        state.selectedIssues.add(issueId);
      }
      updateBulkActionsBar();
      renderSearchResults();
    }

    function selectAllVisibleIssues() {
      const results = state.searchQuery ? searchIssues(state.searchQuery) : state.filteredIssues;
      results.forEach(issue => state.selectedIssues.add(issue.id));
      updateBulkActionsBar();
      renderSearchResults();
    }

    function deselectAllIssues() {
      state.selectedIssues.clear();
      updateBulkActionsBar();
      renderSearchResults();
    }

    function updateBulkActionsBar() {
      const bulkActionsBar = document.getElementById('bulkActionsBar');
      const selectedCount = document.getElementById('selectedCount');
      const selectAllCheckbox = document.getElementById('selectAllCheckbox');

      if (state.selectedIssues.size > 0) {
        bulkActionsBar.style.display = 'flex';
        selectedCount.textContent = state.selectedIssues.size;
        
        // Update select all checkbox state
        const results = state.searchQuery ? searchIssues(state.searchQuery) : state.filteredIssues;
        const allSelected = results.length > 0 && results.every(issue => state.selectedIssues.has(issue.id));
        
        if (selectAllCheckbox) {
          selectAllCheckbox.indeterminate = !allSelected && state.selectedIssues.size > 0;
          selectAllCheckbox.checked = allSelected;
        }
      } else {
        bulkActionsBar.style.display = 'none';
        if (selectAllCheckbox) {
          selectAllCheckbox.indeterminate = false;
          selectAllCheckbox.checked = false;
        }
      }
    }

    function setupMultiSelectionListeners() {
      const selectAllCheckbox = document.getElementById('selectAllCheckbox');
      const fixSelectedBtn = document.getElementById('fixSelectedBtn');
      const clearSelectionBtn = document.getElementById('clearSelectionBtn');

      if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
          if (e.target.checked) {
            selectAllVisibleIssues();
          } else {
            deselectAllIssues();
          }
        });
      }

      if (fixSelectedBtn) {
        fixSelectedBtn.addEventListener('click', () => {
          fixSelectedIssues();
        });
      }

      if (clearSelectionBtn) {
        clearSelectionBtn.addEventListener('click', () => {
          deselectAllIssues();
        });
      }
    }

    function fixSelectedIssues() {
      if (state.selectedIssues.size === 0) {
        alert('No issues selected. Please select issues to fix.');
        return;
      }

      const issueIds = Array.from(state.selectedIssues);
      const count = issueIds.length;

      // Show progress message
      const message = `🔧 Attempting to fix ${count} issue${count !== 1 ? 's' : ''}...`;
      addMessage('assistant', message);

      // Add progress bar to chat
      const progressId = `progress-${Date.now()}`;
      const progressHtml = `
        <div id="${progressId}" class="batch-progress">
          <div class="progress-info">
            <span>Processing: <strong id="${progressId}-status">0/${count}</strong></span>
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar" id="${progressId}-bar" style="width: 0%"></div>
          </div>
        </div>
      `;
      elements.messages.insertAdjacentHTML('beforeend', progressHtml);
      elements.messages.scrollTop = elements.messages.scrollHeight;

      // Call batch fix endpoint
      fetch('/api/issues/batch-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          issueIds,
          workspacePath: process.cwd ? process.cwd() : process.env.WORKSPACE_PATH || '.',
          options: {
            autoApply: true,
            confidenceThreshold: 0.7,
            backup: true,
            verification: true
          }
        })
      })
        .then(res => res.json())
        .then(data => {
          // Update progress to complete
          const progressBar = document.getElementById(`${progressId}-bar`);
          const progressStatus = document.getElementById(`${progressId}-status`);
          if (progressBar) progressBar.style.width = '100%';
          if (progressStatus) progressStatus.textContent = `${data.data.summary.successCount}/${count}`;

          // Process results
          if (data.success && data.data) {
            const result = data.data;
            
            // Build results summary
            let summary = `\n📊 **Batch Fix Results**\n`;
            summary += `• Successful: ${result.summary.successCount}/${result.totalAttempted} (${result.summary.successRate})\n`;
            
            if (result.summary.failureCount > 0) {
              summary += `• Failed: ${result.summary.failureCount}\n`;
            }
            
            if (result.summary.skippedCount > 0) {
              summary += `• Skipped (low confidence): ${result.summary.skippedCount}\n`;
            }

            // Show detailed results for each status
            if (result.successful.length > 0) {
              summary += `\n✅ **Successfully Fixed** (${result.successful.length})\n`;
              result.successful.slice(0, 5).forEach(fix => {
                summary += `• ${fix.issueId} (confidence: ${(fix.confidence * 100).toFixed(0)}%)\n`;
              });
              if (result.successful.length > 5) {
                summary += `• ... and ${result.successful.length - 5} more\n`;
              }
            }

            if (result.failed.length > 0) {
              summary += `\n❌ **Failed to Fix** (${result.failed.length})\n`;
              result.failed.slice(0, 3).forEach(fail => {
                summary += `• ${fail.issueId}: ${fail.reason}\n`;
              });
              if (result.failed.length > 3) {
                summary += `• ... and ${result.failed.length - 3} more\n`;
              }
            }

            if (result.skipped.length > 0) {
              summary += `\n⏭️  **Skipped** (${result.skipped.length})\n`;
              result.skipped.slice(0, 3).forEach(skip => {
                summary += `• ${skip.issueId}: ${skip.reason}\n`;
              });
              if (result.skipped.length > 3) {
                summary += `• ... and ${result.skipped.length - 3} more\n`;
              }
            }

            addMessage('assistant', summary);
            
            // Clear selection and refresh
            deselectAllIssues();
            updateBulkActionsBar();
            
            // Refresh analysis after delay
            setTimeout(() => analyzeProject(), 1000);
          } else {
            addMessage('assistant', `❌ Error fixing issues: ${data.error || 'Unknown error'}`);
          }
        })
        .catch(err => {
          addMessage('assistant', `❌ Error: ${err.message}`);
        });
    }

    function renderTasks() {
      document.getElementById('taskCount').textContent = state.tasks.length;
      if (state.tasks.length === 0) {
        elements.issuesList.innerHTML = '<div class="empty-state"><h3>No tasks loaded</h3><p>Load a task JSON file to view its tasks.</p></div>';
        return;
      }

      elements.issuesList.innerHTML = state.tasks.map(task => `
        <div class="task-card">
          <div class="task-card-heading">
            <span>${escapeHtml(task.id || 'Task')}</span>
            <span>${escapeHtml(task.status || task.state || '')}</span>
          </div>
          <div class="task-title">${escapeHtml(task.name || task.title || 'Untitled task')}</div>
          <div class="task-description">${escapeHtml(task.description || '')}</div>
        </div>
      `).join('');
    }

    async function analyzeProject({ quiet = false } = {}) {
      elements.analyzeBtn.disabled = true;
      elements.sidebarStatus.textContent = 'Analyzing the current workspace...';
      try {
        const response = await fetch('api/issues');
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Live analysis failed.');

        state.issues = (result.issues || []).map(normalizeIssue);
        state.selectedIssue = null;
        switchSidebarView('issues');
        updateStats();
        elements.sidebarStatus.textContent = state.issues.length
          ? `Analysis complete. ${state.issues.length} live issue${state.issues.length === 1 ? '' : 's'} found.`
          : 'Analysis complete. No issues were found by the available analyzers.';
      } catch (error) {
        state.issues = [];
        state.selectedIssue = null;
        switchSidebarView('issues');
        updateStats();
        elements.sidebarStatus.textContent = 'Live analysis unavailable. Start the UI server with npm run ui and retry.';
        if (!quiet) addAssistantMessage(`Live analysis failed: ${escapeHtml(error.message)}`);
      } finally {
        elements.analyzeBtn.disabled = false;
      }
    }

    function normalizeIssue(issue) {
      const severity = String(issue.severity || 'info').toLowerCase();
      const knownSeverities = ['critical', 'error', 'warning', 'info'];
      return {
        ...issue,
        id: String(issue.id || `${issue.file}:${issue.startLine}:${issue.rule}`),
        severity: knownSeverities.includes(severity) ? severity : 'info',
        ruleId: String(issue.rule || issue.ruleId || issue.type || 'unknown'),
        message: String(issue.message || issue.title || 'Unspecified issue'),
        file: String(issue.file || issue.filePath || 'Unknown file'),
        line: issue.startLine || issue.line || '?'
      };
    }

    // Security Scan (P11-T015)
    async function runSecurityScan() {
      const securityScanBtn = document.getElementById('securityScanBtn');
      if (!securityScanBtn) return;

      securityScanBtn.disabled = true;
      securityScanBtn.textContent = '⏳ Scanning...';
      elements.sidebarStatus.textContent = 'Running security scan...';

      try {
        // Show progress message
        addMessage('assistant', '🔒 Starting security scan...');

        const response = await fetch('/api/security/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scanTypes: ['vulnerabilities', 'secrets', 'dependencies'],
            workspacePath: process.cwd ? process.cwd() : '.'
          })
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || 'Security scan failed');
        }

        // Process results
        if (result.success && result.data) {
          const scanResults = result.data;
          
          // Build summary
          let summary = '📊 **Security Scan Results**\n\n';

          // Vulnerabilities
          if (scanResults.vulnerabilities && scanResults.vulnerabilities.length > 0) {
            const vulnBySeverity = {
              critical: scanResults.vulnerabilities.filter(v => v.severity === 'critical').length,
              high: scanResults.vulnerabilities.filter(v => v.severity === 'high').length,
              medium: scanResults.vulnerabilities.filter(v => v.severity === 'medium').length,
              low: scanResults.vulnerabilities.filter(v => v.severity === 'low').length
            };

            summary += `🚨 **Vulnerabilities** (${scanResults.vulnerabilities.length} total)\n`;
            summary += `• 🔴 Critical: ${vulnBySeverity.critical}\n`;
            summary += `• 🟠 High: ${vulnBySeverity.high}\n`;
            summary += `• 🟡 Medium: ${vulnBySeverity.medium}\n`;
            summary += `• 🟢 Low: ${vulnBySeverity.low}\n\n`;
          } else {
            summary += `✅ No vulnerabilities detected\n\n`;
          }

          // Secrets
          if (scanResults.secrets && scanResults.secrets.length > 0) {
            summary += `🔑 **Secrets Found** (${scanResults.secrets.length} total)\n`;
            summary += `⚠️  Exposed credentials detected - review immediately!\n\n`;
          } else {
            summary += `✅ No exposed secrets found\n\n`;
          }

          // Dependencies
          if (scanResults.dependencies && scanResults.dependencies.length > 0) {
            summary += `📦 **Dependency Issues** (${scanResults.dependencies.length} total)\n`;
            summary += `Review outdated and vulnerable packages\n\n`;
          } else {
            summary += `✅ Dependencies are up to date\n\n`;
          }

          // Recommendations
          summary += `💡 **Recommendations**\n`;
          if (vulnBySeverity && vulnBySeverity.critical > 0) {
            summary += `• Immediately patch critical vulnerabilities\n`;
          }
          if (scanResults.secrets && scanResults.secrets.length > 0) {
            summary += `• Rotate exposed credentials\n`;
          }
          if (scanResults.vulnerabilities && scanResults.vulnerabilities.length > 10) {
            summary += `• Use batch fixing to apply patches efficiently\n`;
          }

          addMessage('assistant', summary);

          // Update issues list with security-specific results
          const securityIssues = [];
          
          if (scanResults.vulnerabilities) {
            securityIssues.push(...scanResults.vulnerabilities.map(v => ({
              ...v,
              category: 'vulnerability'
            })));
          }

          if (scanResults.secrets) {
            securityIssues.push(...scanResults.secrets.map(s => ({
              ...s,
              severity: 'critical',
              category: 'secret'
            })));
          }

          if (scanResults.dependencies) {
            securityIssues.push(...scanResults.dependencies.map(d => ({
              ...d,
              category: 'dependency'
            })));
          }

          // Merge with existing issues and filter to security
          state.issues = securityIssues.map(normalizeIssue);
          switchSidebarView('issues');
          updateStats();

          elements.sidebarStatus.textContent = `Security scan complete. Found ${securityIssues.length} security issues.`;
        } else {
          throw new Error('Invalid scan response');
        }
      } catch (error) {
        addMessage('assistant', `❌ Security scan failed: ${escapeHtml(error.message)}`);
        elements.sidebarStatus.textContent = 'Security scan failed';
      } finally {
        securityScanBtn.disabled = false;
        securityScanBtn.textContent = '🔒 Security Scan';
      }
    }

    async function loadTasksFromFile(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;

      try {
        const data = JSON.parse(await file.text());
        let tasks;
        if (Array.isArray(data)) tasks = data;
        else if (Array.isArray(data.tasks)) tasks = data.tasks;
        else if (data.tasks && typeof data.tasks === 'object') {
          tasks = Object.values(data.tasks).flat(Infinity).filter(task => task && typeof task === 'object' && !Array.isArray(task));
        } else {
          throw new Error('The JSON file does not contain a task list.');
        }

        state.tasks = tasks;
        document.getElementById('taskCount').textContent = tasks.length;
        elements.sidebarStatus.textContent = `Loaded ${tasks.length} tasks from ${file.name}.`;
        switchSidebarView('tasks');
      } catch (error) {
        elements.sidebarStatus.textContent = `Could not load task file: ${error.message}`;
      } finally {
        elements.tasksFile.value = '';
      }
    }

    // Select issue
    function selectIssue(issueId) {
      const selectedIssue = state.issues.find(i => i.id === issueId);
      if (!selectedIssue) return;

      state.selectedIssue = selectedIssue;
      renderIssues();

      // Add message about selected issue
      addAssistantMessage(
        `Selected issue: <strong>${escapeHtml(selectedIssue.message)}</strong><br>
        <br>
        File: ${escapeHtml(selectedIssue.file)}:${escapeHtml(selectedIssue.line)}<br>
        Severity: ${escapeHtml(selectedIssue.severity)}<br>
        Rule: ${escapeHtml(selectedIssue.ruleId)}<br>
        <br>
        Would you like me to fix this automatically?`,
        [{
          text: '✓ Fix It',
          action: () => generateFix(selectedIssue)
        }, {
          text: '💡 Explain',
          action: () => explainIssue(selectedIssue)
        }]
      );
    }

    // Send message
    function sendMessage() {
      const text = elements.messageInput.value.trim();
      if (!text) return;

      addUserMessage(text);
      elements.messageInput.value = '';
      elements.messageInput.style.height = 'auto';

      // Simulate processing
      showTypingIndicator();

      setTimeout(() => {
        hideTypingIndicator();
        handleUserMessage(text);
      }, 1000 + Math.random() * 1000);
    }

    // Add user message
    function addUserMessage(text) {
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message user';
      messageDiv.innerHTML = `
        <div class="message-avatar">👤</div>
        <div class="message-content">
          <div class="message-text">${text}</div>
        </div>
      `;
      elements.messages.appendChild(messageDiv);
      scrollToBottom();
    }

    // Add assistant message
    function addAssistantMessage(text, actions = []) {
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message assistant';

      let actionsHtml = '';
      if (actions.length > 0) {
        actionsHtml = `
          <div class="message-actions">
            ${actions.map(action =>
              `<button type="button" class="btn btn-primary">${action.text}</button>`
            ).join('')}
          </div>
        `;
      }

      messageDiv.innerHTML = `
        <div class="message-avatar">🤖</div>
        <div class="message-content">
          <div class="message-text">${text}</div>
          ${actionsHtml}
        </div>
      `;

      messageDiv.querySelectorAll('.message-actions button').forEach((button, index) => {
        button.addEventListener('click', actions[index].action);
      });

      elements.messages.appendChild(messageDiv);
      scrollToBottom();
    }

    // Handle user message
    function handleUserMessage(text) {
      const lowerText = text.toLowerCase();

      if (lowerText.includes('fix') || lowerText.includes('repair')) {
        if (state.selectedIssue) {
          generateFix(state.selectedIssue);
        } else {
          addAssistantMessage('Please select an issue from the sidebar first, then I can help you fix it! 😊');
        }
      } else if (lowerText.includes('explain') || lowerText.includes('what') || lowerText.includes('why')) {
        if (state.selectedIssue) {
          explainIssue(state.selectedIssue);
        } else {
          addAssistantMessage('Which issue would you like me to explain? Please select one from the sidebar. 📝');
        }
      } else if (lowerText.includes('all') || lowerText.includes('batch')) {
        fixAllIssues();
      } else {
        addAssistantMessage(
          'I can help you with:<br><br>' +
          '• <strong>Fix issues</strong> - "Fix the selected issue"<br>' +
          '• <strong>Explain issues</strong> - "Explain why this is a problem"<br>' +
          'Select a live issue to review it, or load a task JSON file in the sidebar.'
        );
      }
    }

    // Generate fix
    async function generateFix(issue) {
      addAssistantMessage('🔍 Analyzing the issue and generating a fix...');
      try {
        const response = await fetch('api/generate-fix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ issue })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Fix generation failed.');

        const confidence = Number.isFinite(result.confidence) ? result.confidence : null;
        const confidenceClass = confidence === null ? 'low' : confidence > 0.8 ? 'high' : confidence > 0.6 ? 'medium' : 'low';
        addAssistantMessage(
          `✅ Fix generated successfully!
          <div class="fix-preview">
            <div class="fix-preview-header">
              <span>Proposed Fix for ${escapeHtml(issue.ruleId)}</span>
              <span class="confidence-badge confidence-${confidenceClass}">${confidence === null ? 'Confidence unavailable' : `${Math.round(confidence * 100)}% confidence`}</span>
            </div>
            <div class="diff-view">
              <div class="diff-section">
                <h4>BEFORE</h4>
                <pre>${escapeHtml(result.originalCode)}</pre>
              </div>
              <div class="diff-section">
                <h4>AFTER</h4>
                <pre>${escapeHtml(result.fixedCode)}</pre>
              </div>
            </div>
          </div>`,
          [{
            text: '✓ Apply Fix',
            action: () => applyFix(issue, result)
          }, {
            text: '✗ Reject',
            action: () => addAssistantMessage('Fix rejected. The code will remain unchanged.')
          }]
        );
      } catch (error) {
        addAssistantMessage(`Fix generation failed: ${escapeHtml(error.message)}`);
      }
    }

    // Apply fix
    async function applyFix(issue, fix) {
      addAssistantMessage('✨ Applying fix to the file...');
      try {
        const response = await fetch('api/apply-fix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ issue, originalCode: fix.originalCode, fixedCode: fix.fixedCode })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Fix could not be applied.');

        state.stats.fixed++;
        await analyzeProject({ quiet: true });
        addAssistantMessage(
          `Fix applied to <code>${escapeHtml(issue.file)}</code>.<br>` +
          `Backup: <code>${escapeHtml(result.backupPath)}</code>`
        );
      } catch (error) {
        addAssistantMessage(`Fix application failed: ${escapeHtml(error.message)}`);
      }
    }

    // Explain issue
    function explainIssue(issue) {
      const explanations = {
        'no-unused-vars': 'This rule prevents unused variables in your code. Unused variables can lead to confusion and make the code harder to maintain. They may also indicate incomplete implementations or bugs.',
        'complexity': 'High cyclomatic complexity indicates that a function has too many decision paths. This makes the code harder to test, understand, and maintain. Consider breaking the function into smaller, focused functions.',
        'no-console': 'Console statements should not be left in production code. They can expose sensitive information and impact performance. Use a proper logging library instead.',
        'prefer-const': 'Variables that are never reassigned should be declared with `const` instead of `let`. This makes the code more predictable and prevents accidental reassignment.',
        'prettier/prettier': 'Code formatting is inconsistent with the project style guide. Consistent formatting improves readability and reduces diff noise in version control.'
      };

      const explanation = explanations[issue.ruleId] || 'This is a code quality issue that should be addressed to improve maintainability.';

      addAssistantMessage(
        `💡 <strong>Understanding: ${issue.ruleId}</strong><br><br>` +
        explanation +
        '<br><br>Would you like me to fix this issue?',
        [{
          text: '✓ Fix It',
          action: () => generateFix(issue)
        }]
      );
    }

    // Fix all issues
    function fixAllIssues() {
      addAssistantMessage('Batch fixing is not available in the live chat UI. Review and apply each generated fix individually.');
    }

    // Update stats
    function updateStats() {
      state.stats.total = state.issues.length + state.stats.fixed;
      state.stats.successRate = state.stats.total > 0 
        ? Math.round((state.stats.fixed / state.stats.total) * 100)
        : 0;

      elements.totalIssues.textContent = state.stats.total;
      elements.fixedCount.textContent = state.stats.fixed;
      elements.successRate.textContent = state.stats.successRate + '%';
    }

    // Show typing indicator
    function showTypingIndicator() {
      const indicator = document.createElement('div');
      indicator.className = 'message assistant';
      indicator.id = 'typing-indicator';
      indicator.innerHTML = `
        <div class="message-avatar">🤖</div>
        <div class="message-content">
          <div class="typing-indicator">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
          </div>
        </div>
      `;
      elements.messages.appendChild(indicator);
      scrollToBottom();
    }

    // Hide typing indicator
    function hideTypingIndicator() {
      const indicator = document.getElementById('typing-indicator');
      if (indicator) {
        indicator.remove();
      }
    }

    // Scroll to bottom
    function scrollToBottom() {
      elements.messages.scrollTop = elements.messages.scrollHeight;
    }

    // Escape HTML
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Start
    init();



// ============================================================================
// AI Generation Panel (P11-T060)
// ============================================================================

// AI Panel State
const aiState = {
  currentForm: 'code',
  provider: 'openai',
  costTracking: {
    today: 0,
    month: 0,
    budget: 100
  }
};

// Initialize AI Panel
function initializeAIPanel() {
  const aiTab = document.getElementById('aiTab');
  const aiPanel = document.getElementById('aiPanel');
  const aiGenerationType = document.getElementById('aiGenerationType');
  const aiGenerateBtn = document.getElementById('aiGenerateBtn');
  const aiProvider = document.getElementById('aiProvider');

  // Tab switching
  aiTab?.addEventListener('click', () => {
    showAIPanel();
  });

  // Generation type change
  aiGenerationType?.addEventListener('change', (e) => {
    switchAIForm(e.target.value);
    updateCostEstimate();
  });

  // Provider change
  aiProvider?.addEventListener('change', (e) => {
    aiState.provider = e.target.value;
    updateCostEstimate();
  });

  // Generate button
  aiGenerateBtn?.addEventListener('click', () => {
    handleAIGenerate();
  });

  // Result action buttons
  document.getElementById('aiCopyBtn')?.addEventListener('click', copyAIResult);
  document.getElementById('aiApplyBtn')?.addEventListener('click', applyAIResult);
  document.getElementById('aiSaveBtn')?.addEventListener('click', saveAIResult);
  document.getElementById('aiClearBtn')?.addEventListener('click', clearAIResult);

  // Input change listeners for cost estimation
  const inputs = [
    'codeDescription', 'testFilePath', 'docFilePath', 
    'fixIssueId', 'refactorDescription'
  ];
  inputs.forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateCostEstimate);
  });

  // Load cost tracking from localStorage
  loadCostTracking();
  updateCostDisplay();
  initializeSettingsPanel();
}

function initializeSettingsPanel() {
  const dialog = document.getElementById('settingsDialog');
  const settingsBtn = document.getElementById('settingsBtn');
  const form = document.getElementById('settingsForm');
  const provider = document.getElementById('aiSettingsProvider');
  const keyInput = document.getElementById('aiSettingsApiKey');
  const status = document.getElementById('settingsSaveStatus');
  const credentialStatus = document.getElementById('aiCredentialStatus');
  const apiBase = window.AQT_API_BASE || 'http://localhost:3000';

  if (!dialog || !form || !settingsBtn) return;

  settingsBtn.addEventListener('click', async () => {
    status.textContent = '';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    await loadSettings();
  });
  document.getElementById('settingsCloseBtn')?.addEventListener('click', () => dialog.close());
  document.getElementById('settingsCancelBtn')?.addEventListener('click', () => dialog.close());

  provider.addEventListener('change', () => {
    const local = provider.value === 'ollama';
    keyInput.disabled = local;
    keyInput.placeholder = local ? 'Ollama does not require a key' : 'Enter a provider API key';
    credentialStatus.textContent = local
      ? 'Ollama runs locally; no cloud credential is used.'
      : 'API keys supplied here remain in the running server process only.';
  });

  async function loadSettings() {
    try {
      const response = await fetch(`${apiBase}/api/ai/config`);
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || body.error || response.statusText);
      const data = body.data;
      provider.value = data.provider;
      document.getElementById('aiSettingsModel').value = data.model || '';
      document.getElementById('aiSettingsMaxCost').value = data.maxCost;
      document.getElementById('aiSettingsMonthlyBudget').value = data.monthlyBudget;
      document.getElementById('aiSettingsRateLimit').value = data.requestsPerMinute;
      keyInput.value = '';
      provider.dispatchEvent(new Event('change'));
      credentialStatus.textContent = data.credentialsConfigured
        ? `Provider credential status: configured via ${data.credentialsSource || 'server settings'}.`
        : 'No provider credential is configured. Use an API key or configure the server environment.';
    } catch (error) {
      status.textContent = `Could not load settings: ${error.message}`;
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    status.textContent = 'Saving settings…';
    const payload = {
      provider: provider.value,
      model: document.getElementById('aiSettingsModel').value.trim(),
      maxCost: Number(document.getElementById('aiSettingsMaxCost').value),
      monthlyBudget: Number(document.getElementById('aiSettingsMonthlyBudget').value),
      requestsPerMinute: Number(document.getElementById('aiSettingsRateLimit').value)
    };
    if (keyInput.value) payload.apiKey = keyInput.value;

    try {
      const response = await fetch(`${apiBase}/api/ai/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || body.error || response.statusText);
      keyInput.value = '';
      document.getElementById('aiProvider').value = payload.provider;
      status.textContent = 'Settings saved. API keys are not persisted to disk.';
      credentialStatus.textContent = body.data.credentialsConfigured
        ? 'Provider credential is configured for this server.'
        : 'Provider credential is not configured.';
    } catch (error) {
      status.textContent = `Settings were not saved: ${error.message}`;
    }
  });
}

// Show AI Panel
function showAIPanel() {
  // Hide other panels
  document.getElementById('issuesList').style.display = 'none';
  document.getElementById('aiPanel').style.display = 'block';

  // Update tabs
  document.querySelectorAll('.sidebar-tab').forEach(tab => {
    tab.classList.remove('active');
    tab.setAttribute('aria-selected', 'false');
  });
  document.getElementById('aiTab').classList.add('active');
  document.getElementById('aiTab').setAttribute('aria-selected', 'true');

  // Initialize with code form
  switchAIForm('code');
}

// Switch between AI generation forms
function switchAIForm(type) {
  aiState.currentForm = type;

  // Hide all forms
  document.querySelectorAll('.ai-form').forEach(form => {
    form.classList.remove('active');
    form.style.display = 'none';
  });

  // Show selected form
  const formMap = {
    code: 'codeGenForm',
    test: 'testGenForm',
    doc: 'docGenForm',
    fix: 'fixIssueForm',
    refactor: 'refactorForm'
  };

  const formId = formMap[type];
  const form = document.getElementById(formId);
  if (form) {
    form.classList.add('active');
    form.style.display = 'block';
  }
}

// Update cost estimate
function updateCostEstimate() {
  let estimatedCost = 0;
  const provider = aiState.provider;

  // Base costs per provider (per 1K tokens)
  const pricing = {
    openai: { input: 0.03, output: 0.06 },
    anthropic: { input: 0.015, output: 0.075 },
    google: { input: 0.0005, output: 0.0015 },
    ollama: { input: 0, output: 0 }
  };

  if (provider === 'ollama') {
    estimatedCost = 0;
  } else {
    // Estimate based on generation type
    const type = aiState.currentForm;
    const estimates = {
      code: 0.05,
      test: 0.08,
      doc: 0.04,
      fix: 0.03,
      refactor: 0.10
    };
    estimatedCost = estimates[type] || 0.05;
  }

  document.getElementById('aiCostEstimate').textContent = `$${estimatedCost.toFixed(4)}`;
}

// Handle AI generation
async function handleAIGenerate() {
  const type = aiState.currentForm;
  const provider = aiState.provider;
  
  // Get form data
  const formData = getAIFormData(type);
  if (!formData) return;

  // Show progress
  document.getElementById('aiProgress').style.display = 'flex';
  document.getElementById('aiResult').style.display = 'none';
  document.getElementById('aiGenerateBtn').disabled = true;

  try {
    // Call API endpoint
    const endpoint = `/api/ai/generate/${type === 'fix' ? 'fix' : type}`;
    const response = await fetch(`http://localhost:3000${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...formData,
        provider
      })
    });

    if (!response.ok) {
      throw new Error(`Generation failed: ${response.statusText}`);
    }

    const result = await response.json();
    
    // Display result
    displayAIResult(result.data);

    // Update cost tracking
    if (result.data.cost) {
      updateCostTracking(result.data.cost);
    }

    // Add to chat
    addChatMessage('assistant', `✅ ${getGenerationTypeLabel(type)} completed successfully!`);

  } catch (error) {
    console.error('AI generation error:', error);
    addChatMessage('assistant', `❌ Generation failed: ${error.message}`);
    alert(`Generation failed: ${error.message}`);
  } finally {
    document.getElementById('aiProgress').style.display = 'none';
    document.getElementById('aiGenerateBtn').disabled = false;
  }
}

// Get form data based on type
function getAIFormData(type) {
  switch (type) {
    case 'code':
      const description = document.getElementById('codeDescription').value.trim();
      if (!description) {
        alert('Please enter a description');
        return null;
      }
      return {
        description,
        language: document.getElementById('codeLanguage').value,
        framework: document.getElementById('codeFramework').value.trim() || undefined
      };

    case 'test':
      const testPath = document.getElementById('testFilePath').value.trim();
      if (!testPath) {
        alert('Please enter a file path');
        return null;
      }
      return {
        filePath: testPath,
        framework: document.getElementById('testFramework').value
      };

    case 'doc':
      const docPath = document.getElementById('docFilePath').value.trim();
      if (!docPath) {
        alert('Please enter a file path');
        return null;
      }
      return {
        filePath: docPath,
        format: document.getElementById('docFormat').value
      };

    case 'fix':
      const issueId = document.getElementById('fixIssueId').value.trim();
      if (!issueId) {
        alert('Please enter an issue ID');
        return null;
      }
      return {
        issueId,
        dryRun: document.getElementById('fixDryRun').checked
      };

    case 'refactor':
      const refactorPath = document.getElementById('refactorFilePath').value.trim();
      const refactorDesc = document.getElementById('refactorDescription').value.trim();
      if (!refactorPath || !refactorDesc) {
        alert('Please enter file path and refactoring goal');
        return null;
      }
      return {
        filePath: refactorPath,
        description: refactorDesc
      };

    default:
      return null;
  }
}

// Display AI result
function displayAIResult(data) {
  const resultDiv = document.getElementById('aiResult');
  const contentDiv = document.getElementById('aiResultContent');
  const costSpan = document.getElementById('aiActualCost');

  // Extract content based on result structure
  let content = '';
  if (data.code) content = data.code;
  else if (data.tests) content = data.tests;
  else if (data.documentation) content = data.documentation;
  else if (data.refactoredCode) content = data.refactoredCode;
  else if (data.fix) content = data.fix;
  else content = JSON.stringify(data, null, 2);

  contentDiv.textContent = content;
  costSpan.textContent = `$${(data.cost || 0).toFixed(4)}`;
  resultDiv.style.display = 'block';

  // Store for actions
  aiState.lastResult = {
    content,
    data
  };
}

// Copy AI result to clipboard
async function copyAIResult() {
  if (!aiState.lastResult) return;

  try {
    await navigator.clipboard.writeText(aiState.lastResult.content);
    addChatMessage('assistant', '📋 Copied to clipboard!');
  } catch (error) {
    alert('Failed to copy to clipboard');
  }
}

// Apply AI result (save to file)
async function applyAIResult() {
  if (!aiState.lastResult) return;

  const type = aiState.currentForm;
  let filename = '';

  // Determine filename
  if (type === 'test') {
    const filePath = document.getElementById('testFilePath').value.trim();
    filename = filePath.replace(/\.(js|ts)$/, '.test$1');
  } else if (type === 'doc') {
    const filePath = document.getElementById('docFilePath').value.trim();
    filename = filePath.replace(/\.(js|ts|py)$/, '.md');
  } else if (type === 'refactor' || type === 'fix') {
    filename = document.getElementById('refactorFilePath')?.value.trim() || 
               document.getElementById('fixIssueId')?.value.trim() + '.js';
  } else {
    filename = prompt('Enter filename to save:', 'generated-code.js');
    if (!filename) return;
  }

  // Trigger download
  downloadFile(aiState.lastResult.content, filename);
  addChatMessage('assistant', `✅ Applied and saved to: ${filename}`);
}

// Save AI result (download)
function saveAIResult() {
  if (!aiState.lastResult) return;

  const filename = prompt('Enter filename:', 'ai-generated.txt');
  if (!filename) return;

  downloadFile(aiState.lastResult.content, filename);
}

// Clear AI result
function clearAIResult() {
  document.getElementById('aiResult').style.display = 'none';
  document.getElementById('aiResultContent').textContent = '';
  aiState.lastResult = null;
}

// Helper: Download file
function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Get generation type label
function getGenerationTypeLabel(type) {
  const labels = {
    code: 'Code generation',
    test: 'Test generation',
    doc: 'Documentation generation',
    fix: 'Issue fix',
    refactor: 'Code refactoring'
  };
  return labels[type] || 'Generation';
}

// Cost tracking functions
function loadCostTracking() {
  try {
    const stored = localStorage.getItem('aqt-ai-costs');
    if (stored) {
      aiState.costTracking = JSON.parse(stored);
    }
  } catch (error) {
    console.error('Failed to load cost tracking:', error);
  }
}

function saveCostTracking() {
  try {
    localStorage.setItem('aqt-ai-costs', JSON.stringify(aiState.costTracking));
  } catch (error) {
    console.error('Failed to save cost tracking:', error);
  }
}

function updateCostTracking(cost) {
  aiState.costTracking.today += cost;
  aiState.costTracking.month += cost;
  saveCostTracking();
  updateCostDisplay();
}

function updateCostDisplay() {
  document.getElementById('costToday').textContent = 
    `$${aiState.costTracking.today.toFixed(2)}`;
  document.getElementById('costMonth').textContent = 
    `$${aiState.costTracking.month.toFixed(2)}`;
  
  const remaining = Math.max(0, aiState.costTracking.budget - aiState.costTracking.month);
  document.getElementById('costRemaining').textContent = 
    `$${remaining.toFixed(2)}`;
}

// Helper: Add chat message (if not already defined)
if (typeof addChatMessage === 'undefined') {
  function addChatMessage(sender, text) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    messageDiv.innerHTML = `
      <div class="message-avatar">${sender === 'user' ? '👤' : '🤖'}</div>
      <div class="message-content">
        <div class="message-text">${text}</div>
      </div>
    `;
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeAIPanel);
} else {
  initializeAIPanel();
}

    // ============================================================================
    // Metrics Dashboard (P11-T016)
    // ============================================================================

    function initializeMetricsPanel() {
      // Auto-load once; subsequent visits use cached data unless refreshed
      if (!state.metricsLoaded) {
        loadMetrics(false);
      }
    }

    async function loadMetrics(forceRefresh) {
      if (!forceRefresh && state.metricsLoaded && state.metricsData) {
        renderMetrics();
        return;
      }

      const loadingEl = document.getElementById('metricsLoading');
      const errorEl   = document.getElementById('metricsError');
      const fileList  = document.getElementById('metricsFileList');

      if (loadingEl) loadingEl.style.display = 'flex';
      if (errorEl)   errorEl.style.display   = 'none';
      if (fileList)  fileList.innerHTML       = '';

      try {
        const res  = await fetch('/api/metrics');
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
        const data = await res.json();
        state.metricsData   = data;
        state.metricsLoaded = true;
        renderMetrics();
      } catch (err) {
        if (errorEl) {
          errorEl.style.display  = 'block';
          errorEl.textContent    = `⚠️  Could not load metrics: ${err.message}`;
        }
      } finally {
        if (loadingEl) loadingEl.style.display = 'none';
      }
    }

    function renderMetrics() {
      const data = state.metricsData;
      if (!data) return;

      const summary = data.summary || {};

      // Update summary cards
      setTextContent('metricsFilesCount',        summary.filesScanned      || data.files?.length || '0');
      setTextContent('metricsFunctionsCount',    summary.functionsAnalyzed || '0');
      setTextContent('metricsIssuesCount',       summary.issuesFound       || '0');

      const avgM = summary.avgMaintainability
        ? summary.avgMaintainability.toFixed(1)
        : '—';
      const maintEl = document.getElementById('metricsAvgMaintainability');
      if (maintEl) {
        maintEl.textContent = avgM;
        maintEl.className   = 'metric-value ' + getMaintainabilityClass(parseFloat(avgM));
      }

      // Render file list
      renderMetricsFileList(data.files || []);
    }

    function renderMetricsFileList(files) {
      const container = document.getElementById('metricsFileList');
      if (!container) return;

      if (!files || files.length === 0) {
        container.innerHTML = '<div class="empty-state small"><p>No file metrics available</p></div>';
        return;
      }

      // Sort by complexity (issue count descending)
      const sorted = [...files].sort((a, b) => (b.issueCount || 0) - (a.issueCount || 0));

      container.innerHTML = sorted.map(file => {
        if (file.error) return '';  // skip errored files

        const shortName   = (file.filePath || '').split(/[\\/]/).pop() || file.filePath;
        const m           = file.metrics   || {};
        const maintIdx    = m.maintainabilityIndex != null ? m.maintainabilityIndex.toFixed(0) : '—';
        const loc         = m.loc          != null ? m.loc          : '—';
        const cyclomatic  = m.avgCyclomaticComplexity != null ? m.avgCyclomaticComplexity.toFixed(1) : '—';
        const issueCount  = file.issueCount || 0;
        const maintClass  = getMaintainabilityClass(parseFloat(maintIdx));

        return `
          <div class="metrics-file-row">
            <div class="metrics-file-name" title="${file.filePath}">${shortName}</div>
            <div class="metrics-file-stats">
              <span class="metrics-badge ${maintClass}" title="Maintainability Index">${maintIdx}</span>
              <span class="metrics-badge neutral" title="Lines of Code">LOC ${loc}</span>
              ${issueCount > 0
                ? `<span class="metrics-badge warning" title="Complexity issues">${issueCount} issues</span>`
                : ''}
            </div>
          </div>`;
      }).join('');
    }

    function getMaintainabilityClass(index) {
      if (isNaN(index)) return 'neutral';
      if (index >= 80)  return 'good';
      if (index >= 65)  return 'warning';
      return 'critical';
    }

    function setTextContent(id, value) {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    }

    // ============================================================================
    // Multi-format Export (P11-T017)
    // ============================================================================

    function showExportDialog() {
      const issues = getIssuesToExport();
      const hint   = document.getElementById('exportDialogHint');
      if (hint) {
        const label = state.selectedIssues.size > 0
          ? `${state.selectedIssues.size} selected issue(s)`
          : `${issues.length} issue(s)`;
        hint.textContent = `Exporting ${label}`;
      }
      const dialog = document.getElementById('exportDialog');
      if (dialog) dialog.style.display = 'flex';
    }

    function hideExportDialog() {
      const dialog = document.getElementById('exportDialog');
      if (dialog) dialog.style.display = 'none';
    }

    function getIssuesToExport() {
      if (state.selectedIssues.size > 0) {
        return state.issues.filter(i => state.selectedIssues.has(i.id));
      }
      if (state.searchQuery && state.searchResults.length > 0) {
        return state.searchResults;
      }
      if (state.filteredIssues && state.filteredIssues.length > 0) {
        return state.filteredIssues;
      }
      return state.issues;
    }

    function exportIssues(format) {
      const issues   = getIssuesToExport();
      const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const map = {
        json:     [issuesToJSON(issues),     `aqt-issues-${ts}.json`,       'application/json'],
        csv:      [issuesToCSV(issues),      `aqt-issues-${ts}.csv`,        'text/csv'],
        markdown: [issuesToMarkdown(issues), `aqt-issues-${ts}.md`,         'text/markdown'],
        sarif:    [issuesToSARIF(issues),    `aqt-issues-${ts}.sarif.json`, 'application/json']
      };
      const entry = map[format];
      if (!entry) return;
      const [content, filename] = entry;
      downloadFile(content, filename);
      hideExportDialog();
    }

    // ── Format converters ──────────────────────────────────────────────────────

    function issuesToJSON(issues) {
      return JSON.stringify(
        { generatedAt: new Date().toISOString(), totalIssues: issues.length, issues },
        null, 2
      );
    }

    function issuesToCSV(issues) {
      const header = 'severity,category,file,line,column,message,ruleId,autoFixLevel';
      const escape = (v) => {
        const s = String(v == null ? '' : v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const rows = issues.map(i =>
        [
          i.severity    || '',
          i.category    || '',
          i.file        || '',
          i.line        || '',
          i.column      || '',
          i.message     || i.description || '',
          i.ruleId      || '',
          i.autoFixLevel || ''
        ].map(escape).join(',')
      );
      return [header, ...rows].join('\n');
    }

    function issuesToMarkdown(issues) {
      const now   = new Date().toISOString();
      const lines = [
        '# Code Quality Report',
        '',
        `**Generated:** ${now}  `,
        `**Total Issues:** ${issues.length}`,
        ''
      ];

      if (issues.length === 0) {
        lines.push('_No issues found._');
        return lines.join('\n');
      }

      // Group by severity
      const groups = {};
      for (const i of issues) {
        const sev = i.severity || 'info';
        if (!groups[sev]) groups[sev] = [];
        groups[sev].push(i);
      }

      const sevOrder = ['critical', 'high', 'medium', 'low', 'info'];
      for (const sev of sevOrder) {
        if (!groups[sev]) continue;
        lines.push(`## ${sev.charAt(0).toUpperCase() + sev.slice(1)} (${groups[sev].length})`);
        lines.push('');
        lines.push('| File | Line | Message | Rule |');
        lines.push('|------|------|---------|------|');
        for (const i of groups[sev]) {
          const file = i.file    || '—';
          const line = i.line    || '—';
          const msg  = (i.message || i.description || '').replace(/\|/g, '\\|');
          const rule = i.ruleId  || '—';
          lines.push(`| \`${file}\` | ${line} | ${msg} | ${rule} |`);
        }
        lines.push('');
      }

      return lines.join('\n');
    }

    function issuesToSARIF(issues) {
      const sarif = {
        version: '2.1.0',
        $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
        runs: [{
          tool: {
            driver: {
              name:           'Advanced Quality Tool',
              version:        '0.4.0',
              informationUri: 'https://github.com/advanced-quality-tool',
              rules:          buildSARIFRules(issues)
            }
          },
          results: issues.map(i => ({
            ruleId:  i.ruleId || 'AQT0000',
            level:   sarifLevel(i.severity),
            message: { text: i.message || i.description || 'Issue detected' },
            locations: [{
              physicalLocation: {
                artifactLocation: {
                  uri:       (i.file || '').replace(/\\/g, '/'),
                  uriBaseId: '%SRCROOT%'
                },
                region: {
                  startLine:   i.line   || 1,
                  startColumn: i.column || 1
                }
              }
            }],
            properties: {
              severity:     i.severity    || 'info',
              category:     i.category    || 'unknown',
              autoFixLevel: i.autoFixLevel || 'manual'
            }
          }))
        }]
      };
      return JSON.stringify(sarif, null, 2);
    }

    function sarifLevel(severity) {
      switch (severity) {
        case 'critical':
        case 'high':   return 'error';
        case 'medium': return 'warning';
        default:       return 'note';
      }
    }

    function buildSARIFRules(issues) {
      const seen  = new Set();
      const rules = [];
      for (const i of issues) {
        const id = i.ruleId || 'AQT0000';
        if (!seen.has(id)) {
          seen.add(id);
          rules.push({
            id,
            name: id,
            shortDescription: { text: id },
            properties: { category: i.category || 'unknown' }
          });
        }
      }
      return rules;
    }
