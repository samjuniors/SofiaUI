/**
 * settings/ShapesSection.tsx — "Audio Agent Shapes" gallery.
 * Extracted verbatim from SettingsSheet (Phase 22 split).
 */

import type { SophiaOS } from '../../sophia/SophiaOS';
import type { SophiaShape } from '../../sophia/types';
import { ALL_SHAPES } from '../../sophia/control';
import { AccordionSection } from './controls';

const SHAPE_LABELS: Record<SophiaShape, string> = {
  organic: 'Sphere',
  circle: 'Ring',
  waveform: 'Waveform',
  bow: 'Bow',
  torus: 'Torus',
  infinity: 'Infinity',
  helix: 'DNA Helix',
  hypercube: 'Tesseract',
  pyramid: 'Pyramid',
  star: 'Star',
  galaxy: 'Galaxy',
  heart: 'Heart',
  shield: 'Shield',
  matrix: 'Matrix',
  split: 'Split',
  merge: 'Merge',
  dissolve: 'Dissolve',
  face: 'Face',
  spiky: 'Spiky',
  liquid: 'Liquid',
  'letter-z': 'Glyph Z',
  'letter-s': 'Glyph S',
  'letter-a': 'Glyph A',
  'letter-o': 'Glyph O',
};

function ShapeThumb({ shape }: { shape: SophiaShape }) {
  const stroke = 'rgba(160,210,255,0.85)';
  const common = {
    fill: 'none' as const,
    stroke,
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" aria-hidden="true">
      {shape === 'organic' && <circle cx="12" cy="12" r="7" fill="rgba(90,180,255,0.18)" stroke={stroke} strokeWidth="1.3" />}
      {shape === 'circle' && <circle cx="12" cy="12" r="7" {...common} />}
      {shape === 'waveform' && <path d="M3 12c1.5-6 3-6 4.5 0s3 6 4.5 0 3-6 4.5 0 3 6 4.5 0" {...common} />}
      {shape === 'bow' && <path d="M4 10c4 8 12 8 16 0" {...common} />}
      {shape === 'torus' && (
        <>
          <ellipse cx="12" cy="12" rx="8" ry="4.2" {...common} />
          <ellipse cx="12" cy="12" rx="3.2" ry="1.6" {...common} />
        </>
      )}
      {shape === 'infinity' && <path d="M5 12c0-3 3-5 5-5 4 0 4 10 8 10 2 0 5-2 5-5s-3-5-5-5c-4 0-4 10-8 10-2 0-5-2-5-5z" {...common} />}
      {shape === 'helix' && <path d="M8 4c6 2 6 4 0 6s-6 4 0 6 6 4 0 6" {...common} />}
      {shape === 'hypercube' && (
        <>
          <rect x="5" y="6" width="10" height="10" {...common} />
          <rect x="9" y="8" width="10" height="10" {...common} />
        </>
      )}
      {shape === 'pyramid' && <path d="M12 4 20 19H4z" {...common} />}
      {shape === 'star' && <path d="M12 3.5 14.4 9l6 .4-4.6 3.8 1.5 5.8L12 15.7 6.7 19l1.5-5.8L3.6 9.4l6-.4z" {...common} />}
      {shape === 'galaxy' && (
        <>
          <ellipse cx="12" cy="12" rx="8" ry="3.2" transform="rotate(-28 12 12)" {...common} />
          <circle cx="12" cy="12" r="1.6" fill={stroke} />
        </>
      )}
      {shape === 'heart' && <path d="M12 19s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z" {...common} />}
      {shape === 'shield' && <path d="M12 3 20 7v6c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V7z" {...common} />}
      {shape === 'matrix' && (
        <>
          <path d="M6 6h12v12H6z" {...common} />
          <path d="M6 12h12M12 6v12" {...common} />
        </>
      )}
      {shape === 'split' && (
        <>
          <circle cx="8" cy="12" r="4" {...common} />
          <circle cx="16" cy="12" r="4" {...common} />
        </>
      )}
      {shape === 'merge' && <path d="M5 8c4 0 4 8 7 8s3-8 7-8" {...common} />}
      {shape === 'dissolve' && (
        <>
          <circle cx="8" cy="9" r="1.2" fill={stroke} />
          <circle cx="14" cy="7" r="1" fill={stroke} />
          <circle cx="17" cy="13" r="1.4" fill={stroke} />
          <circle cx="10" cy="16" r="1.1" fill={stroke} />
          <circle cx="12" cy="11" r="1.6" fill={stroke} />
        </>
      )}
      {shape === 'face' && (
        <>
          <circle cx="12" cy="12" r="7.5" {...common} />
          <circle cx="9.5" cy="10.5" r="0.8" fill={stroke} />
          <circle cx="14.5" cy="10.5" r="0.8" fill={stroke} />
          <path d="M9 14.5c1.5 1.2 4.5 1.2 6 0" {...common} />
        </>
      )}
      {shape === 'spiky' && (
        <path d="M12 3l2 5 5-2-2 5 5 2-5 2 2 5-5-2-2 5-2-5-5 2 2-5-5-2 5-2-2-5 5 2z" {...common} />
      )}
      {shape.startsWith('letter-') && (
        <text x="12" y="16.5" textAnchor="middle" fontSize="11" fill={stroke} fontFamily="Inter, sans-serif">
          {shape.slice(-1).toUpperCase()}
        </text>
      )}
    </svg>
  );
}

export function ShapesSection({
  os,
  isOpen,
  onToggle,
}: {
  os: SophiaOS;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const triggerShape = (sh: SophiaShape) => {
    os.execCommand(`shape ${sh}`);
  };

  return (
    <AccordionSection
      title="Audio Agent Shapes"
      badge={`${ALL_SHAPES.length} Forms`}
      isOpen={isOpen}
      onToggle={onToggle}
    >
      <p className="text-[8.5px] font-light text-white/40">
        Transforms Sophia into sacred geometries. Say or trigger commands like &ldquo;waveform&rdquo;, &ldquo;torus&rdquo;, or &ldquo;spiky&rdquo;.
      </p>
      <div className="grid grid-cols-2 gap-1.5 max-h-[220px] overflow-y-auto pr-1">
        {ALL_SHAPES.map((sh) => (
          <button
            key={sh}
            type="button"
            onClick={() => triggerShape(sh)}
            className="flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-2.5 text-left text-[9px] tracking-wide text-white/70 transition-all hover:border-sky-400/40 hover:bg-sky-400/[0.08] hover:text-white active:scale-[0.98]"
          >
            <ShapeThumb shape={sh} />
            <span className="truncate">{SHAPE_LABELS[sh]}</span>
          </button>
        ))}
      </div>
    </AccordionSection>
  );
}
