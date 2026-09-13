import { chatCompletionWithTools, MODELS } from '../../llm/groqClient.js';
import { buildMessages } from './agentInterface.js';
import { getSystemPrompt } from '../../memory/agentConfigStore.js';
import { listSkillsMenu, getSkillBody } from '../../memory/skillStore.js';
import { callCodeRunner } from '../../llm/codeRunnerClient.js';
import { githubReadFile, githubWriteFile, githubListFiles, githubCreatePullRequest } from '../../llm/githubClient.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';

export const name = 'dev';

const GITHUB_ENABLED = !!config.githubToken;

export const DEFAULT_SYSTEM_PROMPT = `You are the dev/build specialist on the user's AI cofounder team. \
You help with code, debugging, architecture, and technical build decisions. Be concrete and \
give runnable code or exact commands where relevant. Keep answers focused, not padded. \
You have real tools — run_code, read_file, write_file, list_files, run_shell — that operate in a \
sandboxed workspace persisting across turns for this user's current project. Use them whenever \
running/inspecting real code would give a more reliable answer than reasoning about it, instead of \
just describing what the code would do. Use use_skill when a listed skill matches what's being asked.${
  GITHUB_ENABLED
    ? ' You also have github_read_file, github_write_file, github_list_files, and github_create_pr for ' +
      'working against a real GitHub repo (owner/repo the user names). You can NEVER write directly to ' +
      "the repo's default branch — always work on a feature branch (e.g. kully/<short-topic>) and open a " +
      'PR with github_create_pr when the change is ready for review.'
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
      description: 'Run a shell command in the sandbox workspace (e.g. wc -l file.py, ls -la, node -v).',
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
                branch: { type: 'string', description: 'Defaults to the repo default branch if omitted.' },
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
                path: { type: 'string', description: 'Directory path, empty string for repo root.' },
                branch: { type: 'string' },
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
                body: { type: 'string' },
              },
              required: ['owner', 'repo', 'branch', 'title'],
            },
          },
        },
      ]
    : []),
];

const MAX_TOOL_ITERATIONS = 4;

async function runTool(call, ctx) {
  const args = JSON.parse(call.function.arguments);

  switch (call.function.name) {
    case 'run_code':
      return callCodeRunner({ action: 'run', language: args.language, code: args.code, userId: ctx.userId, project: ctx.project });
    case 'run_shell':
      return callCodeRunner({ action: 'run_shell', language: args.language, command: args.command, userId: ctx.userId, project: ctx.project });
    case 'read_file':
      return callCodeRunner({ action: 'read_file', language: args.language, path: args.path, userId: ctx.userId, project: ctx.project });
    case 'write_file':
      return callCodeRunner({ action: 'write_file', language: args.language, path: args.path, content: args.content, userId: ctx.userId, project: ctx.project });
    case 'list_files':
      return callCodeRunner({ action: 'list_files', language: args.language, userId: ctx.userId, project: ctx.project });
    case 'use_skill': {
      const body = await getSkillBody(args.name);
      return body ? { skill: args.name, instructions: body } : { error: `no such skill: ${args.name}` };
    }
    case 'github_read_file':
      return githubReadFile(args);
    case 'github_list_files':
      return githubListFiles(args);
    case 'github_write_file':
      return githubWriteFile(args);
    case 'github_create_pr':
      return githubCreatePullRequest(args);
    default:
      return { error: `unknown tool: ${call.function.name}` };
  }
}

/** @type {import('./agentInterface.js').AgentHandler} */
export async function handle(ctx) {
  const basePrompt = await getSystemPrompt(name, DEFAULT_SYSTEM_PROMPT);

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

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const message = await chatCompletionWithTools({
      model: MODELS.smart,
      messages,
      tools: TOOLS,
      temperature: 0.4,
    });

    if (!message.tool_calls?.length) {
      return { reply: message.content ?? '' };
    }

    messages.push({ role: 'assistant', content: message.content ?? '', tool_calls: message.tool_calls });

    for (const call of message.tool_calls) {
      let result;
      try {
        result = await runTool(call, ctx);
      } catch (err) {
        logger.warn(`${call.function.name} tool failed:`, err.message);
        result = { error: err.message };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  // Exhausted the loop without a final answer — force one last reply, no tools offered.
  const finalMessage = await chatCompletionWithTools({ model: MODELS.smart, messages, temperature: 0.4 });
  return { reply: finalMessage.content || "I ran out of tool-call turns — here's what I found so far." };
}
