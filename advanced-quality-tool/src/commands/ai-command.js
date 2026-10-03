/**
 * AI Command (P11-T057)
 * 
 * Provides CLI access to AI-powered code generation, fixing, and refactoring capabilities.
 * 
 * Commands:
 *   - ai generate code <description>  - Generate code from description
 *   - ai generate test <file>         - Generate tests for a file
 *   - ai generate doc <file>          - Generate documentation
 *   - ai fix <issue-id>               - Generate fix for specific issue
 *   - ai refactor <file> <desc>       - Refactor code with AI guidance
 *   - ai config <provider>            - Configure AI provider
 *   - ai cost                         - Show cost tracking
 * 
 * @module commands/ai-command
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const { AIGenerationOrchestrator, loadConfig, CostTracker, CloudExecutor, LocalExecutor } = require('../ai-generator');

class AICommand {
  constructor(config = {}) {
    this.config = {
      projectRoot: config.projectRoot || process.cwd(),
      provider: config.provider || process.env.AQT_AI_PROVIDER || 'openai',
      model: config.model || process.env.AQT_AI_MODEL || 'gpt-4',
      maxCost: config.maxCost || parseFloat(process.env.AQT_AI_MAX_COST) || 1.0,
      autoApply: config.autoApply || false,
      ...config
    };

    this.costTracker = new CostTracker({
      monthlyBudget: parseFloat(process.env.AQT_AI_MONTHLY_BUDGET) || 100.0
    });
  }

  /**
   * Main command handler
   */
  async execute(argv) {
    const subcommand = argv._[1]; // 'ai' is argv._[0], subcommand is argv._[1]
    const action = argv._[2];

    try {
      switch (subcommand) {
        case 'generate':
          return await this.handleGenerate(action, argv);
        case 'fix':
          return await this.handleFix(argv);
        case 'refactor':
          return await this.handleRefactor(argv);
        case 'config':
          return await this.handleConfig(argv);
        case 'cost':
          return await this.handleCost(argv);
        default:
          this.showHelp();
          return { success: false, error: 'Unknown subcommand' };
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      if (argv.verbose) {
        console.error(error.stack);
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle 'ai generate' commands
   */
  async handleGenerate(type, argv) {
    switch (type) {
      case 'code':
        return await this.generateCode(argv);
      case 'test':
        return await this.generateTest(argv);
      case 'doc':
        return await this.generateDoc(argv);
      default:
        console.error(chalk.red('Unknown generate type:'), type);
        console.log('\nAvailable types: code, test, doc');
        return { success: false, error: 'Unknown generate type' };
    }
  }

  /**
   * Generate code from natural language description
   */
  async generateCode(argv) {
    const description = argv._.slice(3).join(' '); // Everything after 'ai generate code'
    
    if (!description) {
      console.error(chalk.red('Error: Description required'));
      console.log('\nUsage: aqt ai generate code <description>');
      console.log('Example: aqt ai generate code "Create a user authentication function"');
      return { success: false, error: 'Description required' };
    }

    console.log(chalk.blue('🤖 Generating code...'));
    console.log(chalk.gray(`Description: ${description}`));
    console.log(chalk.gray(`Provider: ${this.config.provider} (${this.config.model})`));
    
    // Check cost limit
    const estimatedCost = this.estimateCost('code-generation', description);
    if (estimatedCost > this.config.maxCost) {
      console.error(chalk.red(`⚠️  Estimated cost $${estimatedCost.toFixed(2)} exceeds limit $${this.config.maxCost.toFixed(2)}`));
      if (!argv.force) {
        console.log(chalk.yellow('Use --force to override'));
        return { success: false, error: 'Cost limit exceeded' };
      }
    }

    const startTime = Date.now();
    
    // Build generation prompt
    const prompt = this.buildCodeGenerationPrompt(description, argv);
    
    // Execute with AI provider
    const executor = this.getExecutor();
    const result = await executor.execute({
      prompt,
      systemPrompt: 'You are an expert software engineer. Generate clean, well-documented, production-ready code.',
      temperature: argv.temperature || 0.7,
      maxTokens: argv.maxTokens || 2000
    });

    const duration = Date.now() - startTime;
    
    if (!result.ok) {
      console.error(chalk.red('❌ Generation failed:'), result.error);
      return { success: false, error: result.error };
    }

    // Track cost
    if (result.cost) {
      this.costTracker.record({
        type: 'code-generation',
        cost: result.cost,
        provider: this.config.provider,
        model: this.config.model
      });
    }

    // Display result
    console.log(chalk.green('✅ Code generated successfully'));
    console.log(chalk.gray(`Duration: ${duration}ms | Cost: $${(result.cost || 0).toFixed(4)}`));
    console.log('\n' + chalk.cyan('─'.repeat(60)));
    console.log(result.content);
    console.log(chalk.cyan('─'.repeat(60)) + '\n');

    // Save to file if requested
    if (argv.output) {
      await this.saveToFile(argv.output, result.content);
      console.log(chalk.green(`💾 Saved to: ${argv.output}`));
    }

    // Apply automatically if requested
    if (argv.autoApply || this.config.autoApply) {
      console.log(chalk.yellow('⚡ Auto-applying changes...'));
      const applied = await this.applyCode(result.content, argv);
      if (applied.success) {
        console.log(chalk.green('✅ Changes applied'));
      } else {
        console.error(chalk.red('❌ Failed to apply:'), applied.error);
      }
    } else {
      console.log(chalk.yellow('💡 Use --auto-apply to apply changes automatically'));
      console.log(chalk.gray('   Or use --output <file> to save to a file'));
    }

    return {
      success: true,
      data: {
        code: result.content,
        cost: result.cost,
        duration,
        provider: this.config.provider,
        model: this.config.model
      }
    };
  }

  /**
   * Generate tests for a file
   */
  async generateTest(argv) {
    const targetFile = argv._[3];
    
    if (!targetFile) {
      console.error(chalk.red('Error: File path required'));
      console.log('\nUsage: aqt ai generate test <file>');
      console.log('Example: aqt ai generate test src/auth.js');
      return { success: false, error: 'File path required' };
    }

    const filePath = path.resolve(this.config.projectRoot, targetFile);
    
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      console.error(chalk.red('Error: File not found:'), targetFile);
      return { success: false, error: 'File not found' };
    }

    console.log(chalk.blue('🤖 Generating tests...'));
    console.log(chalk.gray(`File: ${targetFile}`));
    
    // Read file content
    const content = await fs.readFile(filePath, 'utf8');
    
    // Build test generation prompt
    const prompt = this.buildTestGenerationPrompt(content, targetFile, argv);
    
    // Execute
    const executor = this.getExecutor();
    const result = await executor.execute({
      prompt,
      systemPrompt: 'You are an expert in writing comprehensive, maintainable unit tests.',
      temperature: 0.3, // Lower temperature for more focused tests
      maxTokens: argv.maxTokens || 3000
    });

    if (!result.ok) {
      console.error(chalk.red('❌ Test generation failed:'), result.error);
      return { success: false, error: result.error };
    }

    // Track cost
    if (result.cost) {
      this.costTracker.record({
        type: 'test-generation',
        cost: result.cost,
        provider: this.config.provider,
        model: this.config.model
      });
    }

    console.log(chalk.green('✅ Tests generated successfully'));
    console.log(chalk.gray(`Cost: $${(result.cost || 0).toFixed(4)}`));
    console.log('\n' + chalk.cyan('─'.repeat(60)));
    console.log(result.content);
    console.log(chalk.cyan('─'.repeat(60)) + '\n');

    // Determine test file path
    const testFilePath = argv.output || this.getTestFilePath(targetFile);
    
    if (argv.output || argv.autoApply) {
      await this.saveToFile(testFilePath, result.content);
      console.log(chalk.green(`💾 Saved to: ${testFilePath}`));
    } else {
      console.log(chalk.yellow(`💡 Use --output ${testFilePath} to save tests`));
    }

    return {
      success: true,
      data: {
        tests: result.content,
        cost: result.cost,
        testFile: testFilePath
      }
    };
  }

  /**
   * Generate documentation for a file
   */
  async generateDoc(argv) {
    const targetFile = argv._[3];
    
    if (!targetFile) {
      console.error(chalk.red('Error: File path required'));
      console.log('\nUsage: aqt ai generate doc <file>');
      console.log('Example: aqt ai generate doc src/auth.js');
      return { success: false, error: 'File path required' };
    }

    const filePath = path.resolve(this.config.projectRoot, targetFile);
    
    try {
      await fs.access(filePath);
    } catch (error) {
      console.error(chalk.red('Error: File not found:'), targetFile);
      return { success: false, error: 'File not found' };
    }

    console.log(chalk.blue('🤖 Generating documentation...'));
    console.log(chalk.gray(`File: ${targetFile}`));
    
    const content = await fs.readFile(filePath, 'utf8');
    
    const prompt = this.buildDocGenerationPrompt(content, targetFile, argv);
    
    const executor = this.getExecutor();
    const result = await executor.execute({
      prompt,
      systemPrompt: 'You are an expert technical writer. Generate clear, comprehensive documentation.',
      temperature: 0.5,
      maxTokens: argv.maxTokens || 2000
    });

    if (!result.ok) {
      console.error(chalk.red('❌ Documentation generation failed:'), result.error);
      return { success: false, error: result.error };
    }

    if (result.cost) {
      this.costTracker.record({
        type: 'doc-generation',
        cost: result.cost,
        provider: this.config.provider,
        model: this.config.model
      });
    }

    console.log(chalk.green('✅ Documentation generated successfully'));
    console.log(chalk.gray(`Cost: $${(result.cost || 0).toFixed(4)}`));
    console.log('\n' + chalk.cyan('─'.repeat(60)));
    console.log(result.content);
    console.log(chalk.cyan('─'.repeat(60)) + '\n');

    const docFilePath = argv.output || targetFile.replace(/\.(js|ts|py)$/, '.md');
    
    if (argv.output || argv.autoApply) {
      await this.saveToFile(docFilePath, result.content);
      console.log(chalk.green(`💾 Saved to: ${docFilePath}`));
    }

    return {
      success: true,
      data: {
        documentation: result.content,
        cost: result.cost
      }
    };
  }

  /**
   * Fix a specific issue using AI
   */
  async handleFix(argv) {
    const issueId = argv._[2] || argv.issue;
    
    if (!issueId) {
      console.error(chalk.red('Error: Issue ID required'));
      console.log('\nUsage: aqt ai fix <issue-id>');
      console.log('       aqt ai fix --issue <issue-id>');
      return { success: false, error: 'Issue ID required' };
    }

    console.log(chalk.blue('🤖 Generating fix for issue...'));
    console.log(chalk.gray(`Issue ID: ${issueId}`));

    // Load issue from analysis results
    const issue = await this.loadIssue(issueId);
    if (!issue) {
      console.error(chalk.red('Error: Issue not found'));
      return { success: false, error: 'Issue not found' };
    }

    console.log(chalk.gray(`File: ${issue.filePath}`));
    console.log(chalk.gray(`Message: ${issue.message}`));

    // Use AI generator orchestrator
    const orchestrator = new AIGenerationOrchestrator({
      rootDir: this.config.projectRoot,
      cloudExecutor: this.getExecutor(),
      costTracker: this.costTracker,
      dryRun: argv.dryRun || false,
      onProgress: (event) => {
        if (event.type === 'issue-start') {
          console.log(chalk.blue(`Processing stage: ${event.stage || 'start'}`));
        }
      }
    });

    const result = await orchestrator.processIssue(issue);

    if (!result.success) {
      console.error(chalk.red('❌ Fix generation failed:'), result.reason);
      return { success: false, error: result.reason };
    }

    console.log(chalk.green('✅ Fix generated successfully'));
    
    if (result.applied) {
      console.log(chalk.green('✅ Fix applied to file'));
    } else if (argv.dryRun) {
      console.log(chalk.yellow('🔍 Dry run - no changes made'));
    }

    return {
      success: true,
      data: result
    };
  }

  /**
   * Refactor code with AI guidance
   */
  async handleRefactor(argv) {
    const targetFile = argv._[2];
    const description = argv._.slice(3).join(' ');
    
    if (!targetFile || !description) {
      console.error(chalk.red('Error: File path and description required'));
      console.log('\nUsage: aqt ai refactor <file> <description>');
      console.log('Example: aqt ai refactor src/auth.js "Extract validation logic into separate functions"');
      return { success: false, error: 'File path and description required' };
    }

    const filePath = path.resolve(this.config.projectRoot, targetFile);
    
    try {
      await fs.access(filePath);
    } catch (error) {
      console.error(chalk.red('Error: File not found:'), targetFile);
      return { success: false, error: 'File not found' };
    }

    console.log(chalk.blue('🤖 Refactoring with AI...'));
    console.log(chalk.gray(`File: ${targetFile}`));
    console.log(chalk.gray(`Refactoring: ${description}`));

    const content = await fs.readFile(filePath, 'utf8');
    
    const prompt = this.buildRefactoringPrompt(content, description, targetFile);
    
    const executor = this.getExecutor();
    const result = await executor.execute({
      prompt,
      systemPrompt: 'You are an expert software architect. Refactor code while maintaining functionality and improving quality.',
      temperature: 0.3,
      maxTokens: argv.maxTokens || 4000
    });

    if (!result.ok) {
      console.error(chalk.red('❌ Refactoring failed:'), result.error);
      return { success: false, error: result.error };
    }

    if (result.cost) {
      this.costTracker.record({
        type: 'refactoring',
        cost: result.cost,
        provider: this.config.provider,
        model: this.config.model
      });
    }

    console.log(chalk.green('✅ Refactoring complete'));
    console.log(chalk.gray(`Cost: $${(result.cost || 0).toFixed(4)}`));
    console.log('\n' + chalk.cyan('─'.repeat(60)));
    console.log(result.content);
    console.log(chalk.cyan('─'.repeat(60)) + '\n');

    if (argv.autoApply) {
      await fs.writeFile(filePath, result.content, 'utf8');
      console.log(chalk.green(`✅ Changes applied to: ${targetFile}`));
    } else {
      console.log(chalk.yellow('💡 Use --auto-apply to apply changes automatically'));
      console.log(chalk.yellow('   Or review the output and apply manually'));
    }

    return {
      success: true,
      data: {
        refactoredCode: result.content,
        cost: result.cost
      }
    };
  }

  /**
   * Configure AI provider
   */
  async handleConfig(argv) {
    const provider = argv._[2] || argv.provider;
    
    if (!provider) {
      // Show current configuration
      console.log(chalk.blue('Current AI Configuration:'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(`Provider: ${chalk.green(this.config.provider)}`);
      console.log(`Model: ${chalk.green(this.config.model)}`);
      console.log(`Max Cost: ${chalk.green('$' + this.config.maxCost.toFixed(2))}`);
      console.log(`Auto Apply: ${chalk.green(this.config.autoApply ? 'Yes' : 'No')}`);
      
      const budget = this.costTracker.budget;
      const used = this.costTracker.getTotalCost();
      console.log(`\nMonthly Budget: ${chalk.green('$' + budget.toFixed(2))}`);
      console.log(`Used This Month: ${chalk.yellow('$' + used.toFixed(2))}`);
      console.log(`Remaining: ${chalk.green('$' + (budget - used).toFixed(2))}`);
      
      return { success: true, data: this.config };
    }

    // Set provider
    const validProviders = ['openai', 'anthropic', 'google', 'ollama'];
    if (!validProviders.includes(provider)) {
      console.error(chalk.red('Error: Invalid provider'));
      console.log(`\nValid providers: ${validProviders.join(', ')}`);
      return { success: false, error: 'Invalid provider' };
    }

    this.config.provider = provider;
    
    if (argv.model) {
      this.config.model = argv.model;
    }

    console.log(chalk.green('✅ AI provider configured'));
    console.log(`Provider: ${chalk.blue(this.config.provider)}`);
    console.log(`Model: ${chalk.blue(this.config.model)}`);

    // Save to config file
    await this.saveConfig();

    return { success: true, data: this.config };
  }

  /**
   * Show cost tracking information
   */
  async handleCost(argv) {
    const period = argv.period || 'month';
    
    console.log(chalk.blue('💰 AI Cost Tracking'));
    console.log(chalk.gray('─'.repeat(40)));

    const stats = this.costTracker.getStats();
    
    console.log(`Total Cost: ${chalk.yellow('$' + stats.totalCost.toFixed(4))}`);
    console.log(`Requests: ${chalk.cyan(stats.totalRequests)}`);
    console.log(`Average Cost/Request: ${chalk.gray('$' + stats.avgCostPerRequest.toFixed(4))}`);
    
    console.log('\n' + chalk.blue('By Type:'));
    console.log(chalk.gray('─'.repeat(40)));
    for (const [type, cost] of Object.entries(stats.byType)) {
      console.log(`${type.padEnd(20)} ${chalk.yellow('$' + cost.toFixed(4))}`);
    }

    const budget = this.costTracker.budget;
    const used = stats.totalCost;
    const remaining = budget - used;
    const percentUsed = (used / budget * 100).toFixed(1);

    console.log('\n' + chalk.blue('Budget Status:'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`Monthly Budget: ${chalk.green('$' + budget.toFixed(2))}`);
    console.log(`Used: ${chalk.yellow('$' + used.toFixed(4))} (${percentUsed}%)`);
    console.log(`Remaining: ${chalk.green('$' + remaining.toFixed(2))}`);

    if (percentUsed > 80) {
      console.log(chalk.red('\n⚠️  Warning: Approaching budget limit!'));
    }

    if (argv.export) {
      await this.exportCostReport(argv.export);
      console.log(chalk.green(`\n💾 Cost report exported to: ${argv.export}`));
    }

    return { success: true, data: stats };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  buildCodeGenerationPrompt(description, argv) {
    const language = argv.language || 'javascript';
    const framework = argv.framework || '';
    
    let prompt = `Generate ${language} code for the following requirement:\n\n`;
    prompt += `${description}\n\n`;
    
    if (framework) {
      prompt += `Use the ${framework} framework.\n\n`;
    }
    
    prompt += `Requirements:\n`;
    prompt += `- Write clean, production-ready code\n`;
    prompt += `- Include proper error handling\n`;
    prompt += `- Add JSDoc comments\n`;
    prompt += `- Follow best practices\n`;
    prompt += `- Include example usage\n\n`;
    prompt += `Return only the code, no explanations.`;
    
    return prompt;
  }

  buildTestGenerationPrompt(content, filePath, argv) {
    const framework = argv.framework || 'jest';
    
    let prompt = `Generate comprehensive unit tests for the following code:\n\n`;
    prompt += `File: ${filePath}\n\n`;
    prompt += `\`\`\`\n${content}\n\`\`\`\n\n`;
    prompt += `Requirements:\n`;
    prompt += `- Use ${framework} testing framework\n`;
    prompt += `- Test all public functions/methods\n`;
    prompt += `- Include edge cases and error conditions\n`;
    prompt += `- Aim for >80% code coverage\n`;
    prompt += `- Use descriptive test names\n`;
    prompt += `- Add setup/teardown as needed\n\n`;
    prompt += `Return only the test code, no explanations.`;
    
    return prompt;
  }

  buildDocGenerationPrompt(content, filePath, argv) {
    const format = argv.format || 'markdown';
    
    let prompt = `Generate comprehensive documentation for the following code:\n\n`;
    prompt += `File: ${filePath}\n\n`;
    prompt += `\`\`\`\n${content}\n\`\`\`\n\n`;
    prompt += `Requirements:\n`;
    prompt += `- Format: ${format}\n`;
    prompt += `- Include overview and purpose\n`;
    prompt += `- Document all public APIs\n`;
    prompt += `- Add parameter descriptions\n`;
    prompt += `- Include return values\n`;
    prompt += `- Add usage examples\n`;
    prompt += `- Note any prerequisites or dependencies\n\n`;
    prompt += `Return only the documentation, no code.`;
    
    return prompt;
  }

  buildRefactoringPrompt(content, description, filePath) {
    let prompt = `Refactor the following code:\n\n`;
    prompt += `File: ${filePath}\n\n`;
    prompt += `\`\`\`\n${content}\n\`\`\`\n\n`;
    prompt += `Refactoring goal: ${description}\n\n`;
    prompt += `Requirements:\n`;
    prompt += `- Maintain all existing functionality\n`;
    prompt += `- Improve code quality and maintainability\n`;
    prompt += `- Follow SOLID principles\n`;
    prompt += `- Preserve existing comments and documentation\n`;
    prompt += `- Do not change external APIs unless necessary\n\n`;
    prompt += `Return the complete refactored code.`;
    
    return prompt;
  }

  getExecutor() {
    const provider = this.config.provider;
    
    if (provider === 'ollama') {
      return new LocalExecutor({
        modelName: this.config.model,
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
      });
    }

    return new CloudExecutor({
      provider,
      model: this.config.model,
      apiKey: this.getApiKey(provider)
    });
  }

  getApiKey(provider) {
    const keyMap = {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      google: process.env.GOOGLE_AI_API_KEY
    };
    
    const key = keyMap[provider];
    if (!key) {
      throw new Error(`API key not found for provider: ${provider}. Set ${provider.toUpperCase()}_API_KEY environment variable.`);
    }
    
    return key;
  }

  estimateCost(type, input) {
    // Rough estimation based on input length
    const tokens = Math.ceil(input.length / 4);
    const outputTokens = type === 'code-generation' ? 1000 : 500;
    
    // GPT-4 pricing (as baseline)
    const inputCostPer1k = 0.03;
    const outputCostPer1k = 0.06;
    
    return (tokens / 1000 * inputCostPer1k) + (outputTokens / 1000 * outputCostPer1k);
  }

  getTestFilePath(filePath) {
    const parsed = path.parse(filePath);
    const testDir = parsed.dir.replace(/^src/, 'test').replace(/^lib/, 'test');
    const testName = `${parsed.name}.test${parsed.ext}`;
    return path.join(testDir, testName);
  }

  async saveToFile(filePath, content) {
    const resolved = path.resolve(this.config.projectRoot, filePath);
    const dir = path.dirname(resolved);
    
    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });
    
    await fs.writeFile(resolved, content, 'utf8');
  }

  async applyCode(code, argv) {
    // Extract file path from code if present (looking for // File: comments)
    const fileMatch = code.match(/\/\/ File: (.+)/);
    const targetFile = argv.output || (fileMatch ? fileMatch[1] : null);
    
    if (!targetFile) {
      return { success: false, error: 'No target file specified' };
    }

    await this.saveToFile(targetFile, code);
    return { success: true, file: targetFile };
  }

  async loadIssue(issueId) {
    // Try to load from recent analysis
    const reportPath = path.join(this.config.projectRoot, '.aqt-reports', 'quality-report.json');
    
    try {
      const reportData = await fs.readFile(reportPath, 'utf8');
      const report = JSON.parse(reportData);
      
      // Find issue by ID
      if (report.issues) {
        return report.issues.find(issue => issue.id === issueId || issue.ruleId === issueId);
      }
    } catch (error) {
      // Report not found or parse error
    }
    
    return null;
  }

  async saveConfig() {
    const configPath = path.join(this.config.projectRoot, '.aqt', 'ai-config.json');
    const dir = path.dirname(configPath);
    
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(this.config, null, 2), 'utf8');
  }

  async exportCostReport(outputPath) {
    const stats = this.costTracker.getStats();
    const report = {
      generated: new Date().toISOString(),
      summary: {
        totalCost: stats.totalCost,
        totalRequests: stats.totalRequests,
        avgCostPerRequest: stats.avgCostPerRequest
      },
      byType: stats.byType,
      budget: {
        monthly: this.costTracker.budget,
        used: stats.totalCost,
        remaining: this.costTracker.budget - stats.totalCost
      }
    };
    
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
  }

  showHelp() {
    console.log(chalk.blue.bold('\nAQT AI Command - AI-Powered Code Generation\n'));
    
    console.log(chalk.yellow('Usage:'));
    console.log('  aqt ai <subcommand> [options]\n');
    
    console.log(chalk.yellow('Subcommands:'));
    console.log('  generate code <description>    Generate code from description');
    console.log('  generate test <file>           Generate tests for a file');
    console.log('  generate doc <file>            Generate documentation');
    console.log('  fix <issue-id>                 Generate fix for specific issue');
    console.log('  refactor <file> <description>  Refactor code with AI');
    console.log('  config [provider]              Configure AI provider');
    console.log('  cost                           Show cost tracking\n');
    
    console.log(chalk.yellow('Options:'));
    console.log('  --provider <name>        AI provider (openai, anthropic, google, ollama)');
    console.log('  --model <name>           Model to use (e.g., gpt-4, claude-3-opus)');
    console.log('  --output <file>          Save output to file');
    console.log('  --auto-apply             Automatically apply changes');
    console.log('  --dry-run                Preview without applying');
    console.log('  --force                  Override cost limits');
    console.log('  --max-tokens <n>         Maximum tokens to generate');
    console.log('  --temperature <n>        Sampling temperature (0-1)');
    console.log('  --framework <name>       Framework to use (for tests/code gen)');
    console.log('  --language <name>        Programming language (default: javascript)');
    console.log('  --verbose                Show detailed output\n');
    
    console.log(chalk.yellow('Examples:'));
    console.log('  aqt ai generate code "Create a REST API endpoint for user authentication"');
    console.log('  aqt ai generate test src/auth.js --framework jest');
    console.log('  aqt ai generate doc src/utils.js --output docs/utils.md');
    console.log('  aqt ai fix eslint-no-unused-vars --auto-apply');
    console.log('  aqt ai refactor src/app.js "Split into smaller modules"');
    console.log('  aqt ai config openai --model gpt-4-turbo');
    console.log('  aqt ai cost --period month --export cost-report.json\n');
  }
}

// CLI entry point
async function main(argv) {
  const command = new AICommand();
  const result = await command.execute(argv);
  process.exit(result.success ? 0 : 1);
}

module.exports = { AICommand, main };

// Run if called directly
if (require.main === module) {
  const argv = require('yargs/yargs')(process.argv.slice(2))
    .help()
    .argv;
  
  main(argv).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
