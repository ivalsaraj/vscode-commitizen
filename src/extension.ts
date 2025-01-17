import * as execa from 'execa';
import { join } from 'path';
import * as sander from 'sander';
// tslint:disable-next-line:no-implicit-dependencies
import * as vscode from 'vscode';
import * as wrap from 'wrap-ansi';

let channel: vscode.OutputChannel;

interface Configuration {
  autoSync: boolean;
  subjectLength: number;
  showOutputChannel: 'off' | 'always' | 'onError';
}

function getConfiguration(): Configuration {
  const config = vscode.workspace.getConfiguration().get<Configuration>('commitizen');
  return config!;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  channel = vscode.window.createOutputChannel('commitizen');
  channel.appendLine('Commitizen support started');

  const czConfig = await readCzConfig();

  context.subscriptions.push(vscode.commands.registerCommand('vscode-commitizen.commit', async() => {
    const ccm = new ConventionalCommitMessage(czConfig);
    await ccm.getType();
    await ccm.getScope();
    await ccm.getSubject();
    await ccm.getBody();
    await ccm.getBreaking();
    await ccm.getFooter();
    if (ccm.complete && vscode.workspace.workspaceFolders) {
      await commit(vscode.workspace.workspaceFolders[0].uri.fsPath, ccm.message.trim());
    }
  }));
}

interface CzConfig {
  types: {
    value: string;
    name: string;
    emoji: string;
    emojiCode: string;
  }[];
  scopes: {
    name?: string;
  }[];
  messages: {
    type?: string;
    customScope?: string;
    scope?: string;
    subject?: string;
    body?: string;
    breaking?: string;
    footer?: string;
  };
  allowCustomScopes: boolean;
  allowBreakingChanges: string[];
  footerPrefix: string;
  skipQuestions?: string[];
}

async function readCzConfig(): Promise<CzConfig|undefined> {
  if (!vscode.workspace.workspaceFolders) {
    return undefined;
  }
  let configPath = join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.cz-config.js');
  if (await sander.exists(configPath)) {
    return require(configPath) as CzConfig;
  }
  const pkg = await readPackageJson();
  if (!pkg) {
    return undefined;
  }
  configPath = join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.cz-config.js');
  if (hasCzConfig(pkg)) {
    configPath = join(vscode.workspace.workspaceFolders[0].uri.fsPath, pkg.config['cz-customizable'].config);
  }
  if (!await sander.exists(configPath)) {
    return undefined;
  }
  return require(configPath) as CzConfig;
}

async function readPackageJson(): Promise<object|undefined> {
  if (!vscode.workspace.workspaceFolders) {
    return undefined;
  }
  const pkgPath = join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'package.json');
  if (!await sander.exists(pkgPath)) {
    return undefined;
  }
  return JSON.parse(await sander.readFile(pkgPath));
}

function hasCzConfig(pkg: any): pkg is { config: { 'cz-customizable': { config: string } } } {
  return pkg.config && pkg.config['cz-customizable'] && pkg.config['cz-customizable'].config;
}

async function askOneOf(question: string, picks: vscode.QuickPickItem[],
  save: (pick: vscode.QuickPickItem) => void, customLabel?: string, customQuestion?: string): Promise<boolean> {
  const pickOptions: vscode.QuickPickOptions = {
    placeHolder: question,
    ignoreFocusOut: true,
    matchOnDescription: true,
    matchOnDetail: true
  };
  const pick = await vscode.window.showQuickPick(picks, pickOptions);
  if (pick && pick.label === customLabel && !!customQuestion) {
    const next = await ask(customQuestion || '', input => {
      save({label: input, description: ''});
      return true;
    });
    return next;
  }
  if (pick === undefined) {
    return false;
  }
  save(pick);
  return true;
}

async function ask(question: string, save: (input: string) => void,
  validate?: (input: string) => string): Promise<boolean> {
  const options: vscode.InputBoxOptions = {
    placeHolder: question,
    ignoreFocusOut: true
  };
  if (validate) {
    options.validateInput = validate;
  }
  const input = await vscode.window.showInputBox(options);
  if (input === undefined) {
    return false;
  }
  save(input);
  return true;
}

const DEFAULT_TYPES = [
    {
        value: 'feat',
        name: '       : ✨ A new feature',
        emoji: '✨',
        emojiCode: ':sparkles:'
    },
    {
        value: 'fix',
        name: '        : 🐛 A bug fix',
        emoji: '🐛',
        emojiCode: ':bug:'
    },
    {
        value: 'docs',
        name: '      : 📖 Documentation only changes',
        emoji: '📖',
        emojiCode: ':pencil:'
    },
    {
        value: 'style',
        name: '     : 💄 Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)',
        emoji: '💄',
        emojiCode: ':lipstick:'
    },
    {
        value: 'refactor',
        name: ' : 📦 A code change that neither fixes a bug nor adds a feature',
        emoji: '📦',
        emojiCode: ':package:'
    },
    {
        value: 'perf',
        name: '      : 🚀 A code change that improves performance',
        emoji: '🚀',
        emojiCode: ':rocket:'
    },
    {
        value: 'test',
        name: '      : 🚨 Adding missing tests or correcting existing tests',
        emoji: '🚨',
        emojiCode: ':rotating_light:'
    },
    {
        value: 'build',
        name: '     : 👷 Changes that affect the build system or external dependencies (example scopes: gulp, broccoli, npm)',
        emoji: '👷',
        emojiCode: ':construction_worker:'
    },
    {
        value: 'ci',
        name: '         : 💻 Changes to our CI configuration files and scripts (example scopes: Travis, Circle, BrowserStack, SauceLabs)',
        emoji: '💻',
        emojiCode: ':computer:'
    },
    {
        value: 'chore',
        name: '    : 🎫 Other changes that don\'t modify src or test files',
        emoji: '🎫',
        emojiCode: ':ticket:'
    }
];

const DEFAULT_MESSAGES = {
  type: 'Select the type of change that you\'re committing',
  customScope: 'Denote the SCOPE of this change',
  customScopeEntry: 'Custom scope...',
  scope: 'Denote the SCOPE of this change (optional)',
  subject: 'Write a SHORT, IMPERATIVE tense description of the change',
  body: 'Provide a LONGER description of the change (optional). Use "|" to break new line',
  breaking: 'List any BREAKING CHANGES (optional)',
  footer: 'List any ISSUES CLOSED by this change (optional). E.g.: #31, #34'
};

async function commit(cwd: string, message: string): Promise<void> {
  channel.appendLine(`About to commit '${message}'`);
  try {
    await conditionallyStageFiles(cwd);
    const result = await execa('git', ['commit', '-m', message], {cwd});
    await vscode.commands.executeCommand('git.refresh');
    if (getConfiguration().autoSync) {
      await vscode.commands.executeCommand('git.sync');
    }
    if (hasOutput(result)) {
      result.stdout.split('\n').forEach(line => channel.appendLine(line));
      if (shouldShowOutput(result)) {
        channel.show();
      }
    }
  } catch (e) {
    vscode.window.showErrorMessage(e.message);
    channel.appendLine(e.message);
    channel.appendLine(e.stack);
  }
}

function hasOutput(result?: {stdout?: string}): boolean {
  return Boolean(result && result.stdout);
}

function shouldShowOutput(result: {code: number}): boolean {
  return getConfiguration().showOutputChannel === 'always'
    || getConfiguration().showOutputChannel === 'onError' && result.code > 0;
}

async function conditionallyStageFiles(cwd: string): Promise<void> {
  const hasSmartCommitEnabled = vscode.workspace.getConfiguration('git')
    .get<boolean>('enableSmartCommit') === true;

  if (hasSmartCommitEnabled && !(await hasStagedFiles(cwd))) {
    channel.appendLine('Staging all files (enableSmartCommit enabled with nothing staged)');
    await vscode.commands.executeCommand('git.stageAll');
  }
}

async function hasStagedFiles(cwd: string): Promise<boolean> {
  const result = await execa('git', ['diff', '--name-only', '--cached'], {cwd});
  return hasOutput(result);
}

class ConventionalCommitMessage {

  private static shouldSkip(czConfig: CzConfig|undefined, messageType: string): czConfig is CzConfig {
    return Boolean(czConfig && czConfig.skipQuestions && czConfig.skipQuestions.includes(messageType));
  }

  private static hasScopes(czConfig: CzConfig|undefined): czConfig is CzConfig {
    return Boolean(czConfig && czConfig.scopes && czConfig.scopes.length !== 0);
  }

  private static hasCustomMessage(czConfig: CzConfig|undefined, messageType: string ): czConfig is CzConfig {
    return Boolean(czConfig && czConfig.messages && czConfig.messages.hasOwnProperty(messageType));
  }

  private static getScopePicks(
    czConfig: CzConfig,
    inputMessage: (inputMessage: string) => string
  ): {label: string, description: string}[] {
    const scopePicks = czConfig.scopes.map(scope => ({
      label: scope.name || scope as string,
      description: ''
    }));
    if (czConfig.allowCustomScopes) {
      scopePicks.push({
        label: inputMessage('customScopeEntry'),
        description: ''
      });
    }
    return scopePicks;
  }

  private readonly czConfig: CzConfig|undefined;
  private next = true;

  private type: string;
  private scope: string|undefined;
  private subject: string;
  private body: string|undefined;
  private breaking: string|undefined;
  private footer: string|undefined;

  constructor(czConfig: CzConfig|undefined) {
    this.czConfig = czConfig;
  }

  public async getType(): Promise<void> {
    if (this.next) {
      const types = (this.czConfig && this.czConfig.types) || DEFAULT_TYPES;
      const typePicks = types.map(type => ({
        label: type.value,
        description: type.name
      }));
      this.next = await askOneOf(this.inputMessage('type'), typePicks,
        pick => this.type = pick.label);
    }
  }

  public async getScope(): Promise<void> {
    if (this.next) {
      if (ConventionalCommitMessage.hasScopes(this.czConfig)) {
        if (this.czConfig.scopes && this.czConfig.scopes[0] !== undefined) {
          const scopePicks = ConventionalCommitMessage.getScopePicks(this.czConfig, this.inputMessage);
          this.next = await askOneOf(this.inputMessage('customScope'), scopePicks,
            pick => {
              this.scope = pick.label || undefined;
            },
            this.inputMessage('customScopeEntry'), this.inputMessage('customScope'));
        }
      } else if (!ConventionalCommitMessage.shouldSkip(this.czConfig, 'scope')) {
        this.next = await ask(this.inputMessage('scope'), input => this.scope = input);
      }
    }
  }

  public async getSubject(): Promise<void> {
    if (this.next) {
      const maxLength = getConfiguration().subjectLength;
      const validator = (input: string) => {
        if (input.length === 0 || input.length > maxLength) {
          return `Subject is required and must be less than ${maxLength} characters`;
        }
        return '';
      };
      this.next = await ask(this.inputMessage('subject'),
        input => this.subject = input, validator);
    }
  }

  public async getBody(): Promise<void> {
    if (this.next && !ConventionalCommitMessage.shouldSkip(this.czConfig, 'body')) {
      this.next = await ask(this.inputMessage('body'),
        input => this.body = wrap(input.split('|').join('\n'), 72, {hard: true}));
    }
  }

  public async getBreaking(): Promise<void> {
    if (this.next && !ConventionalCommitMessage.shouldSkip(this.czConfig, 'breaking')) {
      this.next = await ask(this.inputMessage('breaking'), input => this.breaking = input);
    }
  }

  public async getFooter(): Promise<void> {
    if (this.next && !ConventionalCommitMessage.shouldSkip(this.czConfig, 'footer')) {
      this.next = await ask(this.inputMessage('footer'),
        input => this.footer = input);
    }
  }

  public get complete(): boolean {
    return this.next && Boolean(this.type) && Boolean(this.subject);
  }

  public get message(): string {
    const czTypes = this.czConfig && this.czConfig.types;
    const emojiEntry = czTypes!.filter(eachEmoji => eachEmoji.value === this.type);
    const emoji = emojiEntry.length !== 0 ? emojiEntry[0].emojiCode : '';
    // tslint:disable-next-line prefer-template
    return this.type +
      (typeof this.scope === 'string' && this.scope ? `(${this.scope})` : '') +
      `: ${emoji} ${this.subject}\n\n${this.body}\n\n` +
      (this.breaking ? `BREAKING CHANGE: ${this.breaking}\n` : '') +
      this.messageFooter();
  }

  private messageFooter(): string {
    return this.footer
      ? `${this.czConfig && this.czConfig.footerPrefix ? this.czConfig.footerPrefix : 'Closes '}${
      this.footer
      }`
      : '';
  }

  private inputMessage(messageType: string): string {
    return ConventionalCommitMessage.hasCustomMessage(this.czConfig, messageType)
      ? this.czConfig.messages[messageType]
      : DEFAULT_MESSAGES[messageType];
  }
}
