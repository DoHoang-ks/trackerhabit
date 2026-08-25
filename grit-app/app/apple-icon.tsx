import { ImageResponse } from "next/og";

// Sinh apple-touch-icon PNG cho iOS "Add to Home Screen".
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(150deg, #fb7332, #c2410c)",
        }}
      >
        <svg width="110" height="110" viewBox="0 0 24 24" fill="#ffffff">
          <path d="M12 2c1 3.5-1.5 4.8-1.5 7.2 0 1.2.8 2 .8 2 0-1.8 1.4-2.6 1.4-2.6.4 2.2 2.8 3 2.8 6.1A5.5 5.5 0 1 1 6 14.3C6 9 11 8 12 2Z" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
