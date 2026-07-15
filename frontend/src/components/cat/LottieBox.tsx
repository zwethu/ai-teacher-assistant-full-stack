import LottieImport from 'lottie-react';
import type { ComponentType, CSSProperties } from 'react';

export type LottieBoxProps = {
  animationData: unknown;
  loop?: boolean;
  autoplay?: boolean;
  className?: string;
  style?: CSSProperties;
};

// Interop shim: Vite's dev optimizer pre-bundles lottie-react's UMD build,
// whose default export is the CJS exports object ({ default: Component, ... }),
// while the production build resolves the ESM default (the component itself).
// Normalize both so <Lottie /> is always the real component.
const Lottie = (
  (LottieImport as unknown as { default?: ComponentType<LottieBoxProps> }).default ?? LottieImport
) as ComponentType<LottieBoxProps>;

export default Lottie;
