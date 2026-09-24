// The only icon set of the app. Same visual language as the logo mark:
// monoline, 16x16 grid, 1.5 stroke, square caps, mitered (sharp) corners.
// Do not mix in icons from another library.
import type { SVGProps } from 'react';
import { icons } from '@/theme/theme';

type IconProps = SVGProps<SVGSVGElement> & { size?: number; title?: string };

function Icon({ size = 16, title, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${icons.grid} ${icons.grid}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={icons.strokeWidth}
      strokeLinecap={icons.linecap}
      strokeLinejoin={icons.linejoin}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const IconCheck = (p: IconProps) => <Icon {...p}><path d="M3 8.5 6.5 12 13 4.5" /></Icon>;
export const IconCross = (p: IconProps) => <Icon {...p}><path d="M4 4 12 12M12 4 4 12" /></Icon>;
export const IconChevronRight = (p: IconProps) => <Icon {...p}><path d="M6 3.5 10.5 8 6 12.5" /></Icon>;
export const IconChevronDown = (p: IconProps) => <Icon {...p}><path d="M3.5 6 8 10.5 12.5 6" /></Icon>;
export const IconDash = (p: IconProps) => <Icon {...p}><path d="M4 8h8" /></Icon>;
export const IconClock = (p: IconProps) => <Icon {...p}><path d="M2.5 2.5h11v11h-11zM8 5v3.5h2.5" /></Icon>;
export const IconAlert = (p: IconProps) => <Icon {...p}><path d="M8 2 14.5 13.5h-13zM8 6.5v3M8 11.5v.5" /></Icon>;
export const IconBolt = (p: IconProps) => <Icon {...p}><path d="M9.5 1.5 3.5 9h4l-1 5.5 6-7.5h-4z" /></Icon>;
export const IconCopy = (p: IconProps) => <Icon {...p}><path d="M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3" /></Icon>;
export const IconLogout = (p: IconProps) => <Icon {...p}><path d="M6.5 2.5h-4v11h4M10 5l3 3-3 3M13 8H6" /></Icon>;
export const IconRefresh = (p: IconProps) => <Icon {...p}><path d="M13 3v3.5H9.5M13 6.5A5.5 5.5 0 1 0 13.5 9" /></Icon>;
export const IconUpload = (p: IconProps) => <Icon {...p}><path d="M8 11V2.5M4.5 6 8 2.5 11.5 6M2.5 10.5v3h11v-3" /></Icon>;
export const IconSearch = (p: IconProps) => <Icon {...p}><path d="M2.5 2.5h8v8h-8zM10.5 10.5l3 3" /></Icon>;
export const IconKey = (p: IconProps) => <Icon {...p}><path d="M2.5 5.5h5v5h-5zM7.5 8h6M11.5 8v2.5M13.5 8v2" /></Icon>;
export const IconTerminal = (p: IconProps) => <Icon {...p}><path d="M1.5 2.5h13v11h-13zM4.5 6l2 2-2 2M8 10.5h3.5" /></Icon>;
export const IconList = (p: IconProps) => <Icon {...p}><path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.5M2.5 8h.5M2.5 12h.5" /></Icon>;
export const IconUser = (p: IconProps) => <Icon {...p}><path d="M5.5 2.5h5v5h-5zM2.5 13.5v-3h11v3" /></Icon>;
export const IconLink = (p: IconProps) => <Icon {...p}><path d="M7 4.5 9 2.5h4.5V7L11.5 9M9 11.5 7 13.5H2.5V9L4.5 7M6 10l4-4" /></Icon>;
export const IconShield = (p: IconProps) => <Icon {...p}><path d="M8 1.5l5.5 2v4.5c0 3-2.5 5.5-5.5 6.5-3-1-5.5-3.5-5.5-6.5V3.5z" /></Icon>;
export const IconPlus = (p: IconProps) => <Icon {...p}><path d="M8 3v10M3 8h10" /></Icon>;
