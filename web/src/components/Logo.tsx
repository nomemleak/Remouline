// Logo usage rules (see theme.ts > logo):
//  - the PNG artwork is black on transparent: ALWAYS rendered white on our dark UI
//    through `filter: brightness(0) invert(1)` (.logo-img), never shown as-is;
//  - minimum clear space = 25% of the mark height on every side;
//  - under `minFullWidthPx`, the full lockup switches to the icon-only mark;
//  - no color fill, shadow or gradient, ever.
import { logo } from '@/theme/theme';
import { APP_NAME } from '@/lib/app';

type Props = { variant?: 'full' | 'mark'; height: number };

export function Logo({ variant = 'full', height }: Props) {
  const fullWidth = Math.round(height * logo.fullAspect);
  const useMark = variant === 'mark' || fullWidth < logo.minFullWidthPx;
  const width = useMark ? Math.round(height * logo.markAspect) : fullWidth;
  const clear = Math.round(height * logo.clearSpaceRatio);
  return (
    <span style={{ display: 'inline-block', padding: clear, margin: -clear }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="logo-img"
        src={useMark ? logo.markSrc : logo.fullSrc}
        width={width}
        height={height}
        alt={APP_NAME}
      />
    </span>
  );
}
