import type { ReactElement } from 'react';

interface CliIconProps {
  cli?: { id?: string; name?: string; command?: string };
  size?: number;
  className?: string;
}

/** Official Claude Code / Anthropic Sunburst */
export function ClaudeIcon({ className, size = 16 }: { className?: string; size?: number }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"
        fill="#D97757"
      />
    </svg>
  );
}

/** Official OpenAI / Codex Vortex */
export function CodexIcon({ className, size = 16 }: { className?: string; size?: number }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
        fill="#10A37F"
      />
    </svg>
  );
}

/** Official Oh My Pi (OMP) Logo from can1357/oh-my-pi */
export function OhMyPiIcon({ className, size = 16 }: { className?: string; size?: number }): ReactElement {
  return (
    <svg
      viewBox="0 0 120 90"
      width={size}
      height={size}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Pi symbol horizontal bar */}
      <rect x="10" y="8" width="100" height="12" rx="3" fill="#E2E8F0" />
      {/* Left leg */}
      <rect x="25" y="20" width="12" height="62" rx="3" fill="#E2E8F0" />
      {/* Right leg */}
      <rect x="75" y="20" width="12" height="45" rx="3" fill="#E2E8F0" />
      {/* Plugin connector */}
      <rect x="71" y="55" width="20" height="17" rx="3" fill="#F97316" />
      <rect x="76" y="59" width="3" height="9" rx="1" fill="#0F172A" />
      <rect x="82" y="59" width="3" height="9" rx="1" fill="#0F172A" />
      {/* Decorative dots */}
      <circle cx="18" cy="14" r="2.5" fill="#F97316" />
      <circle cx="102" cy="14" r="2.5" fill="#F97316" />
    </svg>
  );
}

/** Official Microsoft Visual Studio Code (VSCode) Ribbon Icon */
export function VSCodeIcon({ className, size = 16 }: { className?: string; size?: number }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"
        fill="#007ACC"
      />
    </svg>
  );
}

/** Official Google Antigravity Logo */
export function AntigravityIcon({ className, size = 16 }: { className?: string; size?: number }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="cli-agy-grad" x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3186FF" />
          <stop offset="45%" stopColor="#A855F7" />
          <stop offset="85%" stopColor="#F43F5E" />
          <stop offset="100%" stopColor="#FBBF24" />
        </linearGradient>
      </defs>
      <path
        d="M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z"
        fill="url(#cli-agy-grad)"
      />
    </svg>
  );
}

/** Official Google Gemini Sparkle */
export function GeminiIcon({ className, size = 16 }: { className?: string; size?: number }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="cli-gemini-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="50%" stopColor="#818CF8" />
          <stop offset="100%" stopColor="#E879F9" />
        </linearGradient>
      </defs>
      <path
        d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z"
        fill="url(#cli-gemini-grad)"
      />
    </svg>
  );
}

/** Git Branch Icon */
export function GitIcon({ className, size = 16 }: { className?: string; size?: number }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M19 13.5a2.5 2.5 0 0 0-1.77.73l-3.46-3.46a2.49 2.49 0 0 0 0-1.54l3.46-3.46A2.5 2.5 0 1 0 15.5 4a2.49 2.49 0 0 0-.27 1.12l-3.46 3.46a2.5 2.5 0 0 0-1.54 0L6.77 5.12A2.5 2.5 0 1 0 5 6.5c.39 0 .76-.09 1.09-.25l3.46 3.46a2.49 2.49 0 0 0 0 1.54l-3.46 3.46A2.5 2.5 0 1 0 7.73 16.5l3.46-3.46c.46.14.95.18 1.45.09l3.46 3.46c-.09.28-.14.58-.14.89a2.5 2.5 0 1 0 2.5-2.5z"
        fill="#F05032"
      />
    </svg>
  );
}

/** Docker Whale Icon */
export function DockerIcon({ className, size = 16 }: { className?: string; size?: number }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="5.5" y="10" width="2" height="2" rx="0.3" fill="#0EA5E9" />
      <rect x="8.5" y="10" width="2" height="2" rx="0.3" fill="#0EA5E9" />
      <rect x="11.5" y="10" width="2" height="2" rx="0.3" fill="#0EA5E9" />
      <rect x="8.5" y="7.5" width="2" height="2" rx="0.3" fill="#0EA5E9" />
      <rect x="11.5" y="7.5" width="2" height="2" rx="0.3" fill="#0EA5E9" />
      <rect x="14.5" y="10" width="2" height="2" rx="0.3" fill="#0EA5E9" />
      <path
        d="M21.5 13c-.3 0-1.3-.2-1.8.6-.5.7-.3 1.4-.3 1.4s-1.2.2-2.2-.4c-1.3-.8-1.5-2.1-1.5-2.1H2.7c-.4 1.8.2 4.1 1.8 5.6 1.8 1.6 4.3 1.9 7 1.9 4.3 0 7.8-2.1 9-5.2.4-.2 1.3-.6 1.4-1.2.1-.5-.4-.6-.4-.6z"
        fill="#0EA5E9"
      />
    </svg>
  );
}

/** Python Icon */
export function PythonIcon({ className, size = 16 }: { className?: string; size?: number }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M11.9 2.5c-4 0-3.7 1.7-3.7 1.7v1.8h3.8v.6H4.7S2 6.3 2 10.3c0 4 2.4 3.9 2.4 3.9h1.4v-2s-.1-2.4 2.3-2.4h3.9s2.2 0 2.2-2.2V4.7S14.6 2.5 11.9 2.5zm-2.1 1.2a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4z"
        fill="#38BDF8"
      />
      <path
        d="M12.1 21.5c4 0 3.7-1.7 3.7-1.7V18H12v-.6h7.3s2.7.3 2.7-3.7c0-4-2.4-3.9-2.4-3.9h-1.4v2s.1 2.4-2.3 2.4H12s-2.2 0-2.2 2.2v2.9s-.4 2.2 2.3 2.2zm2.1-1.2a.7.7 0 1 1 0-1.4.7.7 0 0 1 0 1.4z"
        fill="#FBBF24"
      />
    </svg>
  );
}

/** Node.js / NPM Icon */
export function NodeIcon({ className, size = 16 }: { className?: string; size?: number }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M12 2.5L20.2 7.2V16.8L12 21.5L3.8 16.8V7.2L12 2.5Z"
        stroke="#22C55E"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12 7.5V16.5M12 12L17 9M12 12L7 9"
        stroke="#22C55E"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Generic CLI Fallback Icon */
export function GenericCliIcon({
  name,
  className,
  size = 16,
}: {
  name?: string;
  className?: string;
  size?: number;
}): ReactElement {
  const initial = name ? name.trim().slice(0, 1).toUpperCase() : '';
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect
        x="2.5"
        y="3.5"
        width="19"
        height="17"
        rx="3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeOpacity="0.65"
      />
      <path
        d="M6.5 8.5L10 12L6.5 15.5"
        stroke="#38BDF8"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {initial ? (
        <text
          x="15"
          y="15.5"
          textAnchor="middle"
          fill="#C084FC"
          fontSize="9"
          fontWeight="bold"
          fontFamily="monospace"
        >
          {initial}
        </text>
      ) : (
        <line
          x1="12"
          y1="15.5"
          x2="16.5"
          y2="15.5"
          stroke="#E2E8F0"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export function getCliKind(cli?: { id?: string; name?: string; command?: string }): string {
  if (!cli) return 'generic';
  const id = (cli.id || '').toLowerCase().trim();
  const name = (cli.name || '').toLowerCase().trim();
  const cmd = (cli.command || '').toLowerCase().trim().replace(/\.exe$/, '');

  const matches = (target: string) =>
    id === target ||
    cmd === target ||
    name === target ||
    name.includes(target) ||
    id.includes(target) ||
    cmd.includes(target);

  // 1. OpenAI Codex (check BEFORE vscode so "codex" doesn't match "code")
  if (
    matches('codex') ||
    matches('openai') ||
    matches('chatgpt') ||
    cmd === 'codex' ||
    cmd.startsWith('codex ')
  ) {
    return 'codex';
  }

  // 2. Claude Code / Anthropic
  if (
    matches('claude') ||
    matches('anthropic') ||
    cmd === 'claude' ||
    cmd.startsWith('claude ')
  ) {
    return 'claude';
  }

  // 3. Oh My Pi (omp, oh-my-pi, ohmypi)
  if (
    id === 'omp' ||
    cmd === 'omp' ||
    cmd.startsWith('omp ') ||
    name.includes('oh my pi') ||
    name.includes('ohmypi') ||
    name.includes('oh-my-pi') ||
    id.includes('ohmypi')
  ) {
    return 'ohmypi';
  }

  // 4. Google Antigravity (agy, antigravity)
  if (
    matches('agy') ||
    matches('antigravity') ||
    cmd === 'agy' ||
    cmd.startsWith('agy ')
  ) {
    return 'antigravity';
  }

  // 5. VS Code (Visual Studio Code)
  if (
    id === 'vscode' ||
    id === 'code' ||
    cmd === 'code' ||
    cmd.startsWith('code ') ||
    name.includes('vscode') ||
    name.includes('vs code') ||
    name.includes('visual studio code') ||
    /\bcode\b/i.test(name)
  ) {
    return 'vscode';
  }

  // Other popular developer CLI tools
  if (matches('gemini') || cmd === 'gemini') return 'gemini';
  if (matches('docker') || cmd === 'docker') return 'docker';
  if (matches('git') || matches('gh') || cmd === 'git' || cmd === 'gh') return 'git';
  if (matches('python') || matches('py') || cmd === 'python' || cmd === 'py') return 'python';
  if (
    matches('node') ||
    matches('npm') ||
    matches('pnpm') ||
    matches('yarn') ||
    matches('bun') ||
    cmd === 'npm' ||
    cmd === 'bun'
  ) {
    return 'node';
  }

  return 'generic';
}

export function CliIcon({ cli, size = 16, className }: CliIconProps): ReactElement {
  const kind = getCliKind(cli);
  switch (kind) {
    case 'claude':
      return <ClaudeIcon size={size} className={className} />;
    case 'codex':
      return <CodexIcon size={size} className={className} />;
    case 'ohmypi':
      return <OhMyPiIcon size={size} className={className} />;
    case 'vscode':
      return <VSCodeIcon size={size} className={className} />;
    case 'antigravity':
      return <AntigravityIcon size={size} className={className} />;
    case 'gemini':
      return <GeminiIcon size={size} className={className} />;
    case 'git':
      return <GitIcon size={size} className={className} />;
    case 'docker':
      return <DockerIcon size={size} className={className} />;
    case 'python':
      return <PythonIcon size={size} className={className} />;
    case 'node':
      return <NodeIcon size={size} className={className} />;
    default:
      return <GenericCliIcon name={cli?.name} size={size} className={className} />;
  }
}
