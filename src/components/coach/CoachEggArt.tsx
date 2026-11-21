import classes from "./CoachEggs.module.css";

// Zeichnungen für die Easter Eggs, im selben schlichten Stil wie JBL:
// kräftige schwarze Linien, flache Farben.

// Patricia: ein süßer Hase. Mit `fangs` blitzen kurz die Reißzähne.
export function PatriciaBunny({ size = 120, fangs = false }: { size?: number; fangs?: boolean }) {
  return (
    <svg viewBox="0 0 120 140" width={size} height={(size * 140) / 120} aria-hidden="true">
      <g stroke="#111" strokeWidth="3">
        <ellipse cx="42" cy="34" rx="11" ry="30" fill="#fff" />
        <ellipse cx="78" cy="34" rx="11" ry="30" fill="#fff" />
        <ellipse cx="42" cy="36" rx="5" ry="20" fill="#f7b6c8" strokeWidth="0" />
        <ellipse cx="78" cy="36" rx="5" ry="20" fill="#f7b6c8" strokeWidth="0" />
        <ellipse cx="60" cy="118" rx="34" ry="20" fill="#fff" />
        <circle cx="60" cy="84" r="32" fill="#fff" />
      </g>
      {fangs ? (
        <g>
          <path d="M40 74 L52 80" stroke="#111" strokeWidth="4" strokeLinecap="round" />
          <path d="M80 74 L68 80" stroke="#111" strokeWidth="4" strokeLinecap="round" />
          <circle cx="47" cy="84" r="5" fill="#cf3a33" />
          <circle cx="73" cy="84" r="5" fill="#cf3a33" />
          <path
            d="M44 98 Q60 112 76 98 Z"
            fill="#5a1414"
            stroke="#111"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path d="M50 99 L53 109 L56 100 M64 100 L67 109 L70 99" fill="#fff" stroke="#111" />
        </g>
      ) : (
        <g>
          <circle cx="47" cy="82" r="5" fill="#111" />
          <circle cx="73" cy="82" r="5" fill="#111" />
          <circle cx="49" cy="80" r="1.6" fill="#fff" />
          <circle cx="75" cy="80" r="1.6" fill="#fff" />
          <ellipse cx="38" cy="94" rx="6" ry="3.5" fill="#f7b6c8" />
          <ellipse cx="82" cy="94" rx="6" ry="3.5" fill="#f7b6c8" />
          <path d="M57 92 L63 92 L60 96 Z" fill="#f58fa8" stroke="#111" strokeWidth="2" />
          <path
            d="M53 100 Q56.5 103 60 100 Q63.5 103 67 100"
            fill="none"
            stroke="#111"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </g>
      )}
    </svg>
  );
}

// Nur die Ohren, die hinter JBL hervorschauen
export function BunnyEarsPeek({ size = 60 }: { size?: number }) {
  return (
    <svg viewBox="0 0 60 60" width={size} height={size} aria-hidden="true">
      <g stroke="#111" strokeWidth="3">
        <ellipse cx="20" cy="34" rx="8" ry="24" fill="#fff" transform="rotate(-10 20 34)" />
        <ellipse cx="40" cy="34" rx="8" ry="24" fill="#fff" transform="rotate(10 40 34)" />
      </g>
      <ellipse cx="20" cy="36" rx="3.5" ry="15" fill="#f7b6c8" transform="rotate(-10 20 36)" />
      <ellipse cx="40" cy="36" rx="3.5" ry="15" fill="#f7b6c8" transform="rotate(10 40 36)" />
    </svg>
  );
}

// Aarons Hund: Berner Sennenhund, ein Auge grün, eins braun. Sitzt und schaut zu.
export function CoachDog({ size = 90 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      aria-hidden="true"
      className={classes.walkIn}
    >
      <path
        className={classes.tail}
        d="M92 98 Q114 92 110 70 Q106 84 92 88 Z"
        fill="#1b1b1e"
        stroke="#111"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <g stroke="#111" strokeWidth="3" strokeLinejoin="round">
        <path d="M36 112 Q30 70 48 58 L76 58 Q94 70 90 112 Z" fill="#1b1b1e" />
        <path d="M50 112 Q50 80 62 72 Q74 80 74 112 Z" fill="#fff" />
        <rect x="40" y="100" width="14" height="14" rx="6" fill="#fff" />
        <rect x="70" y="100" width="14" height="14" rx="6" fill="#fff" />
      </g>
      <g className={classes.tilt}>
        <g stroke="#111" strokeWidth="3" strokeLinejoin="round">
          <path d="M34 34 Q22 40 26 62 Q36 60 40 44 Z" fill="#1b1b1e" />
          <path d="M90 34 Q102 40 98 62 Q88 60 84 44 Z" fill="#1b1b1e" />
          <path d="M36 40 Q36 14 62 14 Q88 14 88 40 Q88 64 62 66 Q36 64 36 40 Z" fill="#1b1b1e" />
          <path d="M56 22 L68 22 L72 52 Q62 62 52 52 Z" fill="#fff" strokeWidth="0" />
          <path d="M48 50 Q62 70 76 50 Q72 64 62 64 Q52 64 48 50 Z" fill="#fff" />
        </g>
        <ellipse cx="44" cy="40" rx="5" ry="3" fill="#b5652b" />
        <ellipse cx="80" cy="40" rx="5" ry="3" fill="#b5652b" />
        <circle cx="50" cy="36" r="4.5" fill="#3aa357" stroke="#111" strokeWidth="2" />
        <circle cx="74" cy="36" r="4.5" fill="#7a4a22" stroke="#111" strokeWidth="2" />
        <circle cx="51" cy="35" r="1.3" fill="#fff" />
        <circle cx="75" cy="35" r="1.3" fill="#fff" />
        <ellipse cx="62" cy="52" rx="5" ry="3.5" fill="#111" />
        <path
          d="M62 58 Q62 64 58 64 M62 58 Q62 64 66 64"
          fill="none"
          stroke="#111"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

// Der Hase, den der Bass-Drop quer über den Bildschirm pustet
export function BunnyBlast() {
  return (
    <div className={classes.overlay}>
      <div className={classes.wave} />
      <div className={classes.blast}>
        <svg viewBox="0 0 80 80" width={80} height={80} aria-hidden="true">
          <g stroke="#111" strokeWidth="3">
            <ellipse
              className={classes.flap}
              cx="30"
              cy="20"
              rx="6"
              ry="18"
              fill="#fff"
              transform="rotate(-25 30 20)"
            />
            <ellipse
              className={classes.flap}
              cx="50"
              cy="20"
              rx="6"
              ry="18"
              fill="#fff"
              transform="rotate(25 50 20)"
            />
            <circle cx="40" cy="50" r="22" fill="#fff" />
          </g>
          <path
            d="M31 46 l5 3 M31 52 l5 -3 M49 46 l-5 3 M49 52 l-5 -3"
            stroke="#111"
            strokeWidth="2.5"
          />
          <ellipse cx="40" cy="62" rx="5" ry="4" fill="#5a1414" />
        </svg>
      </div>
    </div>
  );
}

// Bens Lambrusco-Schubkarre
export function LambruscoCart() {
  return (
    <div className={classes.overlay}>
      <div className={classes.cart}>
        <svg viewBox="0 0 220 150" width={220} height={150} aria-hidden="true">
          <g className={classes.bottle}>
            <path
              d="M98 30 L98 12 L108 12 L108 30 Q118 38 118 52 L118 96 L88 96 L88 52 Q88 38 98 30 Z"
              fill="#4a1630"
              stroke="#111"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <rect
              x="96"
              y="6"
              width="14"
              height="8"
              rx="2"
              fill="#f2c94c"
              stroke="#111"
              strokeWidth="2"
            />
            <rect
              x="90"
              y="58"
              width="26"
              height="22"
              rx="3"
              fill="#f6efe0"
              stroke="#111"
              strokeWidth="2"
            />
            <path d="M94 66 H112 M94 72 H108" stroke="#cf3a33" strokeWidth="2.5" />
          </g>
          <g stroke="#111" strokeWidth="3" strokeLinejoin="round">
            <path d="M40 80 L170 80 L150 118 L64 118 Z" fill="#4f86c6" />
            <path d="M170 84 L212 66" fill="none" strokeLinecap="round" />
            <path d="M80 118 L74 140 M136 118 L142 140" fill="none" strokeLinecap="round" />
            <circle cx="40" cy="122" r="18" fill="#2c2f35" />
            <circle cx="40" cy="122" r="6" fill="#f58220" />
          </g>
        </svg>
      </div>
    </div>
  );
}

// Strafzettel für Aaron
export function PenaltyTicket({ title, text }: { title: string; text: string }) {
  return (
    <div className={classes.ticket}>
      <svg
        viewBox="0 0 220 120"
        width="100%"
        style={{ maxWidth: 260 }}
        role="img"
        aria-label={title}
      >
        <path
          d="M6 6 H214 V114 H6 Z"
          fill="#fff7c2"
          stroke="#111"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <rect x="6" y="6" width="208" height="26" fill="#cf3a33" stroke="#111" strokeWidth="3" />
        <text x="110" y="24" textAnchor="middle" fontWeight="800" fontSize="15" fill="#fff">
          {title}
        </text>
        <foreignObject x="14" y="38" width="192" height="72">
          <div style={{ fontSize: 12, lineHeight: 1.35, color: "#111" }}>{text}</div>
        </foreignObject>
      </svg>
    </div>
  );
}

// Karotte für den Karottenrahmen: JBL knabbert demonstrativ daran
export function CarrotBadge({ size = 44 }: { size?: number }) {
  return (
    <svg viewBox="0 0 60 60" width={size} height={size} aria-hidden="true">
      <g stroke="#111" strokeWidth="3" strokeLinejoin="round">
        <path d="M40 14 Q44 4 50 6 Q46 12 44 16 Z" fill="#3aa357" />
        <path d="M40 14 Q34 6 28 8 Q34 14 38 18 Z" fill="#3aa357" />
        <path d="M44 18 Q38 12 32 18 L8 52 Q12 56 16 52 Z" fill="#f58220" />
      </g>
      <path d="M22 36 l6 2 M18 42 l5 2 M28 28 l5 2" stroke="#111" strokeWidth="2" />
      <path d="M10 46 q2 -4 6 -2 q-1 4 -6 2 Z" fill="#fff" stroke="#111" strokeWidth="1.5" />
    </svg>
  );
}
