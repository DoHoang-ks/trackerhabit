import { ImageResponse } from "next/og";

// Favicon PNG.
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: 14,
        }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="#ffffff">
          <path d="M12 2c1 3.5-1.5 4.8-1.5 7.2 0 1.2.8 2 .8 2 0-1.8 1.4-2.6 1.4-2.6.4 2.2 2.8 3 2.8 6.1A5.5 5.5 0 1 1 6 14.3C6 9 11 8 12 2Z" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
