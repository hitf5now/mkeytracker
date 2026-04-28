/**
 * Globally available SVG filter defs for the composite-achievement
 * "electric border" effect on player cards. Rendered once at the root
 * layout so any `.electric-arc` element on the page can reference
 * `url(#electric-warp)` / `url(#electric-warp-b)` regardless of route.
 *
 * The two filters use different seed/frequency families so the two
 * stacked arcs on a card trace independent jagged paths instead of
 * marching in lockstep. Linear feComponentTransfer (slope=5, intercept
 * =-2) saturates the noise so most pixels get near-max displacement
 * with sharp angular flips — that's the zig-zag of forked lightning.
 */
export function ElectricFilters() {
  return (
    <svg
      aria-hidden="true"
      style={{ position: "absolute", width: 0, height: 0 }}
    >
      <defs>
        <filter
          id="electric-warp"
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.014 0.03"
            numOctaves={1}
            seed={2}
            result="rawNoise"
          >
            <animate
              attributeName="seed"
              values="2;13;28;46;72;100"
              dur="7s"
              repeatCount="indefinite"
            />
          </feTurbulence>
          <feComponentTransfer in="rawNoise" result="noise">
            <feFuncR type="linear" slope="5" intercept="-2" />
            <feFuncG type="linear" slope="5" intercept="-2" />
          </feComponentTransfer>
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale={6}
            xChannelSelector="R"
            yChannelSelector="G"
          >
            <animate
              attributeName="scale"
              values="5.2;6.4;5.6;6.8;5.4;6.2;5.2"
              dur="6s"
              repeatCount="indefinite"
            />
          </feDisplacementMap>
        </filter>

        <filter
          id="electric-warp-b"
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.018 0.038"
            numOctaves={1}
            seed={29}
            result="rawNoise"
          >
            <animate
              attributeName="seed"
              values="29;7;48;15;62;21;39"
              dur="6.4s"
              repeatCount="indefinite"
            />
          </feTurbulence>
          <feComponentTransfer in="rawNoise" result="noise">
            <feFuncR type="linear" slope="5" intercept="-2" />
            <feFuncG type="linear" slope="5" intercept="-2" />
          </feComponentTransfer>
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale={6}
            xChannelSelector="R"
            yChannelSelector="G"
          >
            <animate
              attributeName="scale"
              values="5.4;6.6;5.8;6.4;5.2;6.0;5.4"
              dur="5.6s"
              repeatCount="indefinite"
            />
          </feDisplacementMap>
        </filter>
      </defs>
    </svg>
  );
}
