import type { ReactElement } from 'react';

interface NavIconProps {
  size?: number;
  className?: string;
}

/** Local Workspace - Terminal Screen with Glowing Prompt */
export function NavLocalIcon({ size = 20, className }: NavIconProps): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="nav-local-grad" x1="2" y1="3" x2="22" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#EA580C" />
        </linearGradient>
      </defs>
      <rect x="2.5" y="3.5" width="19" height="17" rx="4" stroke="url(#nav-local-grad)" strokeWidth="1.8" />
      <path d="M7 8.5L11 12L7 15.5" stroke="#FBBF24" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="13" y1="15.5" x2="17" y2="15.5" stroke="#F97316" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** SSH Connections - Server Blades with Glowing LEDs */
export function NavServersIcon({ size = 20, className }: NavIconProps): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="nav-servers-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#10B981" />
          <stop offset="100%" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      <rect x="3" y="3.5" width="18" height="7" rx="2.5" stroke="url(#nav-servers-grad)" strokeWidth="1.8" />
      <circle cx="6.5" cy="7" r="1.3" fill="#34D399" />
      <line x1="10" y1="7" x2="17" y2="7" stroke="#34D399" strokeWidth="1.6" strokeLinecap="round" />

      <rect x="3" y="13.5" width="18" height="7" rx="2.5" stroke="url(#nav-servers-grad)" strokeWidth="1.8" />
      <circle cx="6.5" cy="17" r="1.3" fill="#06B6D4" />
      <line x1="10" y1="17" x2="17" y2="17" stroke="#06B6D4" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** SFTP - File Folder with Transfer Arrow */
export function NavSftpIcon({ size = 20, className }: NavIconProps): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="nav-sftp-grad" x1="2" y1="4" x2="22" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#0284C7" />
        </linearGradient>
      </defs>
      <path
        d="M3 6.5C3 5.12 4.12 4 5.5 4H9.2C9.86 4 10.5 4.26 10.97 4.73L12.5 6.27C12.97 6.74 13.61 7 14.27 7H18.5C19.88 7 21 8.12 21 9.5V17.5C21 18.88 19.88 20 18.5 20H5.5C4.12 20 3 18.88 3 17.5V6.5Z"
        stroke="url(#nav-sftp-grad)"
        strokeWidth="1.8"
      />
      <path
        d="M8.5 13.5L12 17M12 17L15.5 13.5M12 17V11"
        stroke="#7DD3FC"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Monitor - Pulse Waveform with Activity Node */
export function NavMonitorIcon({ size = 20, className }: NavIconProps): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="nav-mon-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F43F5E" />
          <stop offset="100%" stopColor="#FB7185" />
        </linearGradient>
      </defs>
      <rect x="2.5" y="3.5" width="19" height="14" rx="3.5" stroke="url(#nav-mon-grad)" strokeWidth="1.8" />
      <path
        d="M5.5 10.5H8L10 6.5L13 14.5L15 10.5H18.5"
        stroke="#FDA4AF"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="6.5" r="1.3" fill="#F43F5E" />
      <circle cx="13" cy="14.5" r="1.3" fill="#FB7185" />
      <line x1="8" y1="20.5" x2="16" y2="20.5" stroke="#F43F5E" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Remote Projects - Stacked Workspace Layers */
export function NavProjectsIcon({ size = 20, className }: NavIconProps): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="nav-proj-grad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#A855F7" />
          <stop offset="100%" stopColor="#6366F1" />
        </linearGradient>
      </defs>
      <path
        d="M12 2.5L20.5 7L12 11.5L3.5 7L12 2.5Z"
        stroke="url(#nav-proj-grad)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 12L12 16.5L20.5 12"
        stroke="#C084FC"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 16.5L12 21L20.5 16.5"
        stroke="#818CF8"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Git - Version Control Branch Nodes */
export function NavGitIcon({ size = 20, className }: NavIconProps): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="nav-git-grad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F97316" />
          <stop offset="100%" stopColor="#EF4444" />
        </linearGradient>
      </defs>
      <circle cx="6.5" cy="6.5" r="2.5" stroke="url(#nav-git-grad)" strokeWidth="1.8" fill="#F97316" fillOpacity="0.25" />
      <circle cx="6.5" cy="17.5" r="2.5" stroke="url(#nav-git-grad)" strokeWidth="1.8" fill="#F97316" fillOpacity="0.25" />
      <circle cx="17.5" cy="11.5" r="2.5" stroke="url(#nav-git-grad)" strokeWidth="1.8" fill="#F97316" fillOpacity="0.25" />
      <line x1="6.5" y1="9" x2="6.5" y2="15" stroke="#FB923C" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M6.5 12C9.5 12 11.5 11.5 15 11.5"
        stroke="#FB923C"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Server Ops - Microservices & Daemons Grid */
export function NavOpsIcon({ size = 20, className }: NavIconProps): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="nav-ops-grad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#818CF8" />
          <stop offset="100%" stopColor="#C084FC" />
        </linearGradient>
      </defs>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" stroke="url(#nav-ops-grad)" strokeWidth="1.8" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" stroke="url(#nav-ops-grad)" strokeWidth="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" stroke="url(#nav-ops-grad)" strokeWidth="1.8" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" stroke="url(#nav-ops-grad)" strokeWidth="1.8" />
      <circle cx="7" cy="7" r="1.3" fill="#818CF8" />
      <circle cx="17" cy="7" r="1.3" fill="#C084FC" />
      <circle cx="7" cy="17" r="1.3" fill="#C084FC" />
      <circle cx="17" cy="17" r="1.3" fill="#818CF8" />
    </svg>
  );
}

/** Provisioning - Devops Crossed Tools */
export function NavProvisionIcon({ size = 20, className }: NavIconProps): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="nav-prov-grad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#EAB308" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
      </defs>
      <path
        d="M14.5 4.5L19.5 9.5M16 3C17.5 4.5 17.5 7 16 8.5L6.5 18L3 17L3 20L4 21L7 21L6 17.5L15.5 8C17 6.5 14.5 4 16 3Z"
        stroke="url(#nav-prov-grad)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 4.5L3.5 9.5M8 3C6.5 4.5 6.5 7 8 8.5L17.5 18L21 17L21 20L20 21L17 21L18 17.5L8.5 8C7 6.5 9.5 4 8 3Z"
        stroke="#FCD34D"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Port Forward - Dual Tunnel Arrows */
export function NavPortForwardIcon({ size = 20, className }: NavIconProps): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="nav-pf-grad" x1="2" y1="4" x2="22" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#14B8A6" />
          <stop offset="100%" stopColor="#2DD4BF" />
        </linearGradient>
      </defs>
      <circle cx="5" cy="8" r="2.3" stroke="url(#nav-pf-grad)" strokeWidth="1.8" fill="#14B8A6" fillOpacity="0.25" />
      <circle cx="19" cy="8" r="2.3" stroke="url(#nav-pf-grad)" strokeWidth="1.8" fill="#14B8A6" fillOpacity="0.25" />
      <circle cx="5" cy="16" r="2.3" stroke="url(#nav-pf-grad)" strokeWidth="1.8" fill="#2DD4BF" fillOpacity="0.25" />
      <circle cx="19" cy="16" r="2.3" stroke="url(#nav-pf-grad)" strokeWidth="1.8" fill="#2DD4BF" fillOpacity="0.25" />
      <path d="M7.5 8H16.5M16.5 8L13.5 5.5M16.5 8L13.5 10.5" stroke="#2DD4BF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.5 16H7.5M7.5 16L10.5 13.5M7.5 16L10.5 18.5" stroke="#5EEAD4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Auth Log - Security Shield */
export function NavAuthLogIcon({ size = 20, className }: NavIconProps): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="nav-auth-grad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#EF4444" />
          <stop offset="100%" stopColor="#F43F5E" />
        </linearGradient>
      </defs>
      <path
        d="M12 3L20 6.5V12C20 16.5 16.5 20.2 12 21.5C7.5 20.2 4 16.5 4 12V6.5L12 3Z"
        stroke="url(#nav-auth-grad)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="11" r="2" fill="#F87171" />
      <path d="M12 13V16.5" stroke="#F87171" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Settings - Precision Cogwheel */
export function NavSettingsIcon({ size = 20, className }: NavIconProps): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="nav-set-grad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#A78BFA" />
          <stop offset="100%" stopColor="#CBD5E1" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="3.2" stroke="url(#nav-set-grad)" strokeWidth="1.8" />
      <path
        d="M12 2.5V5M12 19V21.5M2.5 12H5M19 12H21.5M5.3 5.3L7 7M17 17L18.7 18.7M5.3 18.7L7 17M17 7L18.7 5.3"
        stroke="url(#nav-set-grad)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Sidebar Collapse / Expand Toggle */
export function NavCollapseIcon({
  collapsed = false,
  size = 18,
  className,
}: {
  collapsed?: boolean;
  size?: number;
  className?: string;
}): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" className={className} aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3" stroke="#A78BFA" strokeWidth="1.6" />
      <line x1="9" y1="4" x2="9" y2="20" stroke="#A78BFA" strokeWidth="1.6" />
      {collapsed ? (
        <path d="M13 12H17M17 12L15 9.5M17 12L15 14.5" stroke="#FBBF24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M17 12H13M13 12L15 9.5M13 12L15 14.5" stroke="#FBBF24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}
