import { buildMessages } from './agentInterface.js';
import { runToolLoop } from './toolLoop.js';
import { chatCompletion, MODELS } from '../../llm/groqClient.js';
import { getSystemPrompt } from '../../memory/agentConfigStore.js';
import { listSkillsMenu, getSkillBody } from '../../memory/skillStore.js';
import { listToolConfig } from '../../memory/toolConfigStore.js';
import { callCodeRunner } from '../../llm/codeRunnerClient.js';
import { githubReadFile, githubWriteFile, githubListFiles, githubCreatePullRequest } from '../../llm/githubClient.js';
import { gmailSearch, gmailRead, gmailCreateDraft, driveListFiles, driveReadFile, driveWriteFile } from '../../llm/googleClient.js';
import {
  SCRAPE_TOOL, handleScrapeTool,
  CREATE_ARTIFACT_TOOL, handleCreateArtifactTool,
  GENERATE_IMAGE_TOOL, handleGenerateImageTool,
} from './sharedTools.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';

export const name = 'dev';

const GITHUB_ENABLED = !!config.githubToken;
const GOOGLE_ENABLED = !!config.googleClientId;
const MAX_TOOL_ITERATIONS = 10;

export const DEFAULT_SYSTEM_PROMPT = `You are the dev/build specialist on the user's AI cofounder team. \
You help with code, debugging, architecture, and technical build decisions — including scaffolding and \
building complete small applications, not just snippets. Be concrete and give runnable code or exact \
commands where relevant. Keep answers focused, not padded. \
For anything beyond a trivial one-file change: explore first (list_files/read_file, or github_list_files/ \
github_read_file for a real repo) before editing, make coordinated changes across the files that actually \
need them, then verify with run_shell (run tests/a build) before declaring it done — don't guess blind. \
You have real tools — run_code, read_file, write_file, list_files, run_shell — that operate in a \
sandboxed workspace persisting across turns for this user's current project. The sandbox supports real \
dependency installs (npm install, pip install) and can run test suites/builds — dependency directories \
(node_modules, .venv, etc.) don't persist between calls, so install them again within the same run_shell \
call that needs them (e.g. "npm install && npm test"). Use scrape_url to look up real documentation or \
examples from the web when useful. Use use_skill when a listed skill matches what's being asked. Use \
create_artifact for a substantial finished piece of output (a full file, a report, a design doc) that the \
user would want to view/save on its own — not for short snippets inline in your reply. When asked for an \
image, ALWAYS call the generate_image tool to get a real generated picture — never hand-draw a crude \
SVG/base64 approximation yourself and pass that to create_artifact instead, the user asked for a generated \
image, not primitive shapes. When an uploaded data file (CSV/Excel) is mentioned as \
available in your workspace (under uploads/), install what you need (pandas/matplotlib/openpyxl via pip) \
to actually analyze it, save any chart with matplotlib's savefig, read the PNG back via read_file with \
encoding:"base64", and hand it to the user with create_artifact using kind:"image" and \
content:"data:image/png;base64,"+<the base64 you read back> — never fabricate numbers or a chart you \
didn't actually compute. read_file/write_file take an optional encoding:"base64" for binary files \
(images, spreadsheets); omit it for plain text.${
  GITHUB_ENABLED
    ? ' You also have github_read_file, github_write_file, github_list_files, and github_create_pr for ' +
      'working against a real GitHub repo (owner/repo the user names). You can NEVER write directly to ' +
      "the repo's default branch — always work on a feature branch (e.g. kully/<short-topic>) and open a " +
      'PR with github_create_pr when the change is ready for review.'
    : ''
}${
  GOOGLE_ENABLED
    ? ' You also have gmail_search, gmail_read, gmail_create_draft, drive_list_files, drive_read_file, ' +
      'and drive_write_file for the user\'s connected Google account (if not connected yet, the tool will ' +
      "say so). gmail_create_draft only ever creates a Gmail DRAFT — it never sends email on the user's " +
      'behalf; tell them the draft is ready to review and send themselves.'
    : ''
}`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_code',
      description:
        'Execute a full Node.js or Python program in the sandbox and return stdout/stderr. ' +
        'For quick one-off scripts. Files it writes persist for later calls.',
      parameters: {
        type: 'object',
        properties: {
          language: { type: 'string', enum: ['node', 'python'] },
          code: { type: 'string', description: 'The full source code to run as the entry point.' },
        },
        required: ['language', 'code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description:
        'Run a shell command in the sandbox workspace — e.g. "npm install && npm test", ' +
        '"pip install -r requirements.txt && pytest", wc -l file.py, ls -la.',
      parameters: {
        type: 'object',
        properties: {
          language: { type: 'string', enum: ['node', 'python'], description: 'Which sandbox to run it in — either works for plain shell commands.' },
          command: { type: 'string' },
        },
        required: ['language', 'command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from the persistent project workspace.',
      parameters: {
        type: 'object',
        properties: {
          language: { type: 'string', enum: ['node', 'python'] },
          path: { type: 'string' },
          encoding: { type: ['string', 'null'], enum: ['base64', null], description: 'Pass "base64" for binary files (images, xlsx). Omit/null for plain text.' },
        },
        required: ['language', 'path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write (or overwrite) a file in the persistent project workspace.',
      parameters: {
        type: 'object',
        properties: {
          language: { type: 'string', enum: ['node', 'python'] },
          path: { type: 'string' },
          content: { type: 'string' },
          encoding: { type: ['string', 'null'], enum: ['base64', null], description: 'Pass "base64" if content is base64-encoded binary data. Omit/null for plain text.' },
        },
        required: ['language', 'path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List every file currently in the project workspace.',
      parameters: {
        type: 'object',
        properties: {
          language: { type: 'string', enum: ['node', 'python'] },
        },
        required: ['language'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'use_skill',
      description: 'Fetch the full detailed instructions for a named skill from the menu in the system prompt.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
  },
  SCRAPE_TOOL,
  CREATE_ARTIFACT_TOOL,
  GENERATE_IMAGE_TOOL,
  ...(GITHUB_ENABLED
    ? [
        {
          type: 'function',
          function: {
            name: 'github_read_file',
            description: 'Read a file from a real GitHub repo.',
            parameters: {
              type: 'object',
              properties: {
                owner: { type: 'string' },
                repo: { type: 'string' },
                path: { type: 'string' },
                branch: { type: ['string', 'null'], description: 'Defaults to the repo default branch if omitted/null.' },
              },
              required: ['owner', 'repo', 'path'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'github_list_files',
            description: 'List files/directories at a path in a real GitHub repo.',
            parameters: {
              type: 'object',
              properties: {
                owner: { type: 'string' },
                repo: { type: 'string' },
                path: { type: ['string', 'null'], description: 'Directory path, empty string or null for repo root.' },
                branch: { type: ['string', 'null'] },
              },
              required: ['owner', 'repo'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'github_write_file',
            description:
              'Commit a file change to a GitHub repo on a feature branch (creates the branch from the ' +
              "default branch's tip if it doesn't exist yet). Refuses to write to the default branch itself.",
            parameters: {
              type: 'object',
              properties: {
                owner: { type: 'string' },
                repo: { type: 'string' },
                path: { type: 'string' },
                content: { type: 'string' },
                message: { type: 'string', description: 'Commit message.' },
                branch: { type: 'string', description: 'Feature branch name, e.g. kully/add-input-validation.' },
              },
              required: ['owner', 'repo', 'path', 'content', 'message', 'branch'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'github_create_pr',
            description: 'Open a pull request from a feature branch into the repo default branch.',
            parameters: {
              type: 'object',
              properties: {
                owner: { type: 'string' },
                repo: { type: 'string' },
                branch: { type: 'string' },
                title: { type: 'string' },
                body: { type: ['string', 'null'] },
              },
              required: ['owner', 'repo', 'branch', 'title'],
            },
          },
        },
      ]
    : []),
  ...(GOOGLE_ENABLED
    ? [
        {
          type: 'function',
          function: {
            name: 'gmail_search',
            description: 'Search the user\'s Gmail (Gmail search syntax, e.g. "from:boss@x.com is:unread").',
            parameters: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'gmail_read',
            description: 'Read one email by its message id (from gmail_search results).',
            parameters: {
              type: 'object',
              properties: { messageId: { type: 'string' } },
              required: ['messageId'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'gmail_create_draft',
            description: "Create a Gmail draft (never sends). The user reviews and sends it themselves.",
            parameters: {
              type: 'object',
              properties: {
                to: { type: 'string' },
                subject: { type: 'string' },
                body: { type: 'string' },
              },
              required: ['to', 'subject', 'body'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'drive_list_files',
            description: 'List files in the user\'s Google Drive, optionally filtered by a Drive API query.',
            parameters: {
              type: 'object',
              properties: { query: { type: ['string', 'null'], description: 'e.g. "name contains \'report\'"' } },
              required: [],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'drive_read_file',
            description: 'Read a file from Google Drive (Docs export as plain text, Sheets as CSV).',
            parameters: {
              type: 'object',
              properties: { fileId: { type: 'string' } },
              required: ['fileId'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'drive_write_file',
            description: 'Create a new file in Drive, or overwrite an existing one if fileId is given.',
            parameters: {
              type: 'object',
              properties: {
                fileId: { type: ['string', 'null'], description: 'Omit/null to create a new file.' },
                name: { type: ['string', 'null'], description: 'Required when creating a new file.' },
                content: { type: 'string' },
                mimeType: { type: ['string', 'null'], description: 'Defaults to text/plain.' },
              },
              required: ['content'],
            },
          },
        },
      ]
    : []),
];

export const ALL_TOOL_NAMES = TOOLS.map((t) => t.function.name);

async function dispatch(call, ctx, enabledNames) {
  if (!enabledNames.has(call.function.name)) {
    return { error: `the ${call.function.name} tool is currently disabled in Plugins settings` };
  }

  const args = JSON.parse(call.function.arguments);

  switch (call.function.name) {
    case 'run_code':
      return callCodeRunner({ action: 'run', language: args.language, code: args.code, userId: ctx.userId, project: ctx.project });
    case 'run_shell':
      return callCodeRunner({ action: 'run_shell', language: args.language, command: args.command, userId: ctx.userId, project: ctx.project });
    case 'read_file':
      return callCodeRunner({ action: 'read_file', language: args.language, path: args.path, encoding: args.encoding, userId: ctx.userId, project: ctx.project });
    case 'write_file':
      return callCodeRunner({ action: 'write_file', language: args.language, path: args.path, content: args.content, encoding: args.encoding, userId: ctx.userId, project: ctx.project });
    case 'list_files':
      return callCodeRunner({ action: 'list_files', language: args.language, userId: ctx.userId, project: ctx.project });
    case 'use_skill': {
      const body = await getSkillBody(args.name);
      return body ? { skill: args.name, instructions: body } : { error: `no such skill: ${args.name}` };
    }
    case 'scrape_url':
      return handleScrapeTool(args);
    case 'create_artifact':
      return handleCreateArtifactTool(args, ctx);
    case 'generate_image':
      return handleGenerateImageTool(args, ctx);
    case 'github_read_file':
      return githubReadFile(args);
    case 'github_list_files':
      return githubListFiles(args);
    case 'github_write_file':
      return githubWriteFile(args);
    case 'github_create_pr':
      return githubCreatePullRequest(args);
    case 'gmail_search':
      return gmailSearch(ctx.userId, args.query);
    case 'gmail_read':
      return gmailRead(ctx.userId, args.messageId);
    case 'gmail_create_draft':
      return gmailCreateDraft(ctx.userId, args);
    case 'drive_list_files':
      return driveListFiles(ctx.userId, args.query);
    case 'drive_read_file':
      return driveReadFile(ctx.userId, args.fileId);
    case 'drive_write_file':
      return driveWriteFile(ctx.userId, args);
    default:
      return { error: `unknown tool: ${call.function.name}` };
  }
}

/** @type {import('./agentInterface.js').AgentHandler} */
export async function handle(ctx) {
  const basePrompt = await getSystemPrompt(name, DEFAULT_SYSTEM_PROMPT);

  // A vision turn (an image attached, no data file) is answered as one direct
  // call to the vision model instead of the tool loop — Groq's tool-calling
  // models here aren't the vision-capable one, and a "what's in this photo"
  // question rarely also needs sandbox tools in the same turn.
  if (ctx.images?.length) {
    const messages = buildMessages({ systemPrompt: basePrompt, ctx });
    const reply = await chatCompletion({ model: MODELS.vision, messages, maxTokens: 400 });
    return { reply };
  }

  let skillsMenuText = '';
  try {
    const menu = await listSkillsMenu();
    if (menu.length) {
      skillsMenuText = `\n\nAvailable skills (call use_skill with the name to get full instructions):\n${menu
        .map((s) => `- ${s.name}: ${s.description}`)
        .join('\n')}`;
    }
  } catch (err) {
    logger.warn('skills menu unavailable:', err.message);
  }

  const systemPrompt = basePrompt + skillsMenuText;
  const messages = buildMessages({ systemPrompt, ctx });

  let enabledNames = new Set(ALL_TOOL_NAMES);
  let activeTools = TOOLS;
  try {
    const toolConfig = await listToolConfig(ALL_TOOL_NAMES);
    enabledNames = new Set(toolConfig.filter((t) => t.enabled).map((t) => t.name));
    activeTools = TOOLS.filter((t) => enabledNames.has(t.function.name));
  } catch (err) {
    logger.warn('tool config unavailable, defaulting all tools enabled:', err.message);
  }

  const reply = await runToolLoop({
    messages,
    tools: activeTools,
    dispatch: (call) => dispatch(call, ctx, enabledNames),
    maxIterations: MAX_TOOL_ITERATIONS,
  });
  return { reply };
}
