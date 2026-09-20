import { useCallback, useEffect, useRef, useState } from "react";
import type { LetterSpec } from "./letters";
import type { PaintTool } from "./palette";

type Point = { x: number; y: number };
type StrokeData = { points: Point[]; length: number; startAngle: number; endAngle: number };

const SAMPLES = 60;
const HIT_RADIUS = 34;
const LOOK_AHEAD = 8;
const COMPLETE_AT = 0.85;

function angle(a: Point, b: Point) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

export function TraceLetter({ letter, tool, onComplete }: { letter: LetterSpec; tool: PaintTool; onComplete?: (color: string) => void }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pathRefs = useRef<Array<SVGPathElement | null>>([]);
  const drawing = useRef(false);

  const [data, setData] = useState<StrokeData[]>([]);
  const [progress, setProgress] = useState<number[]>(() => letter.strokes.map(() => 0));
  const [fill, setFill] = useState<string | null>(null);
  const [paint, setPaint] = useState<string | null>(null);

  useEffect(() => {
    if (fill) onComplete?.(fill);
  }, [fill, onComplete]);

  useEffect(() => {
    setFill(null);
    setPaint(null);
    setProgress(letter.strokes.map(() => 0));
  }, [letter]);

  useEffect(() => {
    const measured: StrokeData[] = letter.strokes.map((_, i) => {
      const el = pathRefs.current[i];
      if (!el) return { points: [], length: 0, startAngle: 0, endAngle: 0 };
      const length = el.getTotalLength();
      const points: Point[] = [];
      for (let s = 0; s <= SAMPLES; s++) {
        const p = el.getPointAtLength((length * s) / SAMPLES);
        points.push({ x: p.x, y: p.y });
      }
      return {
        points,
        length,
        startAngle: angle(points[0]!, points[2]!),
        endAngle: angle(points[points.length - 3]!, points[points.length - 1]!),
      };
    });
    setData(measured);
  }, [letter]);

  const toSvgPoint = useCallback((clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }, []);

  const reset = () => setProgress(letter.strokes.map(() => 0));

  const handleDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (tool.kind === "eraser") {
      setFill(null);
      setPaint(null);
      reset();
      return;
    }
    setPaint(tool.crayon.value);
    drawing.current = true;
    advance(e.clientX, e.clientY);
  };

  const advance = (clientX: number, clientY: number) => {
    if (!data.length) return;
    const p = toSvgPoint(clientX, clientY);
    if (!p) return;

    setProgress((prev) => {
      const active = prev.findIndex((v, i) => v < (data[i]?.points.length ?? 1) - 1);
      if (active === -1) return prev;
      const pts = data[active]!.points;
      const start = prev[active] ?? 0;
      let index = start;
      for (let i = start; i <= Math.min(start + LOOK_AHEAD, pts.length - 1); i++) {
        const pt = pts[i]!;
        const d = Math.hypot(pt.x - p.x, pt.y - p.y);
        if (d < HIT_RADIUS) index = i;
      }
      if (index === start) return prev;

      const next = [...prev];
      next[active] = index;
      if (index >= (pts.length - 1) * COMPLETE_AT) next[active] = pts.length - 1;

      const done = next.every((v, i) => v >= (data[i]?.points.length ?? 1) - 1);
      if (done && tool.kind === "color") setFill(tool.crayon.value);
      return next;
    });
  };

  const handleMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    advance(e.clientX, e.clientY);
  };

  const stop = () => {
    drawing.current = false;
  };

  return (
    <svg
      ref={svgRef}
      viewBox={letter.viewBox}
      role="img"
      aria-label={`تتبّع حرف ${letter.name}`}
      className="h-[46vw] max-h-[320px] w-auto touch-none select-none sm:h-64 md:h-72 lg:h-80"
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
    >
      {/* all black outlines first, so joined strokes read as one shape */}
      {letter.strokes.map((d, i) => (
        <path
          key={`edge-${i}`}
          d={d}
          fill="none"
          stroke="oklch(0.12 0 0)"
          strokeWidth={(letter.widths?.[i] ?? 46) + 10}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {letter.strokes.map((d, i) => (
        <path
          key={`inside-${i}`}
          d={d}
          fill="none"
          stroke="var(--card)"
          strokeWidth={letter.widths?.[i] ?? 46}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {letter.strokes.map((d, i) => {
        const stroke = data[i];
        const ratio = stroke && stroke.points.length > 1 ? (progress[i] ?? 0) / (stroke.points.length - 1) : 0;
        const color = fill ?? paint;
        if (!color || !stroke || stroke.length === 0) return null;
        return (
          <path
            key={`ink-${i}`}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={letter.widths?.[i] ?? 46}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={stroke.length}
            strokeDashoffset={stroke.length * (1 - (fill ? 1 : ratio))}
            className="transition-[stroke-dashoffset] duration-100 ease-linear"
          />
        );
      })}

      {letter.strokes.map((d, i) => {
        const stroke = data[i];
        const ratio = stroke ? (progress[i] ?? 0) / (stroke.points.length - 1) : 0;
        return (
          <g key={`guide-${i}`}>
            {/* dashed guide line — hidden once the letter is fully filled */}
            {!fill && (
              <path
                ref={(el) => {
                  pathRefs.current[i] = el;
                }}
                d={d}
                fill="none"
                stroke="oklch(0.18 0 0)"
                strokeWidth={3}
                strokeDasharray="12 12"
                strokeLinecap="round"
              />
            )}
            {/* traced progress */}
            {!fill && !paint && stroke && stroke.length > 0 && (
              <path
                d={d}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={9}
                strokeLinecap="round"
                strokeDasharray={stroke.length}
                strokeDashoffset={stroke.length * (1 - ratio)}
              />
            )}
            {/* thick invisible hit area */}
            <path d={d} fill="none" stroke="transparent" strokeWidth={56} strokeLinecap="round" />
            {/* worksheet direction arrows — hidden once the letter is fully filled */}
            {!fill && stroke && stroke.points.length > 0 && (
              <>
                {(letter.guideArrows?.[i] ?? [0, 1]).map((fraction, arrowIndex) => {
                  const pointIndex = Math.min(
                    stroke.points.length - 1,
                    Math.max(0, Math.round(fraction * (stroke.points.length - 1))),
                  );
                  const point = stroke.points[pointIndex];
                  const before = stroke.points[Math.max(0, pointIndex - 1)];
                  const after = stroke.points[Math.min(stroke.points.length - 1, pointIndex + 1)];
                  if (!point || !before || !after) return null;
                  return <Chevron key={arrowIndex} point={point} rotate={angle(before, after)} />;
                })}
              </>
            )}
          </g>
        );
      })}
      {letter.dots?.map((dot, i) => {
        const outer = letter.dotR ?? 20;
        return (
          <g key={`dot-${i}`}>
            <circle cx={dot.cx} cy={dot.cy} r={outer} fill={fill ?? "var(--card)"} stroke="oklch(0.12 0 0)" strokeWidth={6} />
            {!fill && (
              <circle
                cx={dot.cx}
                cy={dot.cy}
                r={outer * 0.55}
                fill="none"
                stroke="oklch(0.18 0 0)"
                strokeWidth={3}
                strokeDasharray="7 7"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Chevron({ point, rotate }: { point: Point; rotate: number }) {
  return (
    <polyline
      points="-7,-7 0,0 -7,7"
      fill="none"
      stroke="oklch(0.18 0 0)"
      strokeWidth={5}
      strokeLinecap="round"
      strokeLinejoin="round"
      transform={`translate(${point.x} ${point.y}) rotate(${rotate})`}
    />
  );
}
