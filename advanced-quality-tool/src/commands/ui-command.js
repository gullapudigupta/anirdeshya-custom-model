/**
 * UI Command - CLI handler for launching chat interface
 * 
 * Usage:
 *   aqt ui [options]
 * 
 * Options:
 *   --port <port>     Port number (default: 3030)
 *   --host <host>     Host address (default: localhost)
 *   --open            Open browser automatically
 *   --verbose, -v     Verbose output
 *
 * @module commands/ui-command
 */

const { createServer } = require('../ui/websocket-server');
const { exec } = require('child_process');
const os = require('os');

async function run(args) {
  // Parse arguments
  const options = parseArguments(args);

  console.log('\n🎨 Launching Chat UI\n');

  try {
    // Create and start WebSocket server
    const server = await createServer({
      port: options.port,
      host: options.host,
      verbose: options.verbose
    });

    const url = `http://${options.host}:${options.port}`;

    console.log(`\n✅ Server is running!`);
    console.log(`\n📱 Open your browser and navigate to:`);
    console.log(`   ${url}\n`);
    console.log(`💡 Tips:`);
    console.log(`   - Select issues from the sidebar to analyze them`);
    console.log(`   - Chat with the AI to understand and fix code quality issues`);
    console.log(`   - Review and apply fixes interactively\n`);
    console.log(`Press Ctrl+C to stop the server\n`);

    // Open browser if requested
    if (options.open) {
      openBrowser(url);
    }

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\nShutting down server...');
      await server.stop();
      console.log('Server stopped.\n');
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n\nShutting down server...');
      await server.stop();
      console.log('Server stopped.\n');
      process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {});

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);

    // Provide helpful error messages
    if (error.message.includes('EADDRINUSE')) {
      console.error(`Port ${options.port} is already in use.`);
      console.error(`Try a different port: aqt ui --port <port>\n`);
    }

    if (options.verbose) {
      console.error(error.stack);
    }

    process.exit(1);
  }
}

/**
 * Open browser
 */
function openBrowser(url) {
  const platform = os.platform();
  let command;

  switch (platform) {
    case 'darwin': // macOS
      command = `open "${url}"`;
      break;
    case 'win32': // Windows
      command = `start "" "${url}"`;
      break;
    default: // Linux and others
      command = `xdg-open "${url}"`;
      break;
  }

  exec(command, (error) => {
    if (error) {
      console.warn(`Could not open browser automatically: ${error.message}`);
      console.log(`Please open ${url} manually in your browser.`);
    } else {
      console.log('🌐 Opening browser...\n');
    }
  });
}

/**
 * Parse command arguments
 */
function parseArguments(args) {
  const options = {
    port: 3030,
    host: 'localhost',
    open: false,
    verbose: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--port' || arg === '-p') {
      options.port = parseInt(args[++i], 10);
    } else if (arg === '--host' || arg === '-h') {
      options.host = args[++i];
    } else if (arg === '--open' || arg === '-o') {
      options.open = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--help') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

/**
 * Print help
 */
function printHelp() {
  console.log(`
📖 UI Command Help

Usage:
  aqt ui [options]

Options:
  --port <port>      Port number (default: 3030)
  --host <host>      Host address (default: localhost)
  --open, -o         Open browser automatically
  --verbose, -v      Verbose output
  --help             Show this help

Examples:
  aqt ui                    # Launch UI on default port (3030)
  aqt ui --port 8080        # Launch UI on port 8080
  aqt ui --open             # Launch UI and open browser
  aqt ui --host 0.0.0.0     # Allow external connections

Features:
  ✨ Interactive chat interface for code quality issues
  🔍 Issue sidebar with filtering and selection
  💬 AI-powered explanations and fix suggestions
  📊 Real-time statistics and progress tracking
  🎯 One-click fix application with preview
  🔄 Batch fix capability for multiple issues

How to Use:
  1. The server will start and serve the chat UI
  2. Open the URL in your browser (or use --open)
  3. Select issues from the sidebar
  4. Chat with the AI to understand and fix issues
  5. Review and apply fixes interactively

Press Ctrl+C to stop the server.
`);
}

module.exports = {
  run,
  printHelp
};
