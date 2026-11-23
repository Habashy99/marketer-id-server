
import { timingSafeEqual } from "node:crypto";

export default function externalApiKey(req, res, next) {
  const configuredKey = process.env.SECURITY_LOOKUP_API_KEY;
  const providedKey = req.headers["x-api-key"];
console.log("External API middleware:", {
  keyLoaded: Boolean(configuredKey),
  keyLength: configuredKey?.length ?? 0,
  providedKeyReceived: typeof providedKey === "string",
});
  if (!configuredKey) {
    console.error("SECURITY_LOOKUP_API_KEY is not configured.");

    return res.status(500).json({
      success: false,
      message: "External API is not configured.",
    });
  }

  if (
    typeof providedKey !== "string" ||
    !providedKey ||
    providedKey.length !== configuredKey.length
  ) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized.",
    });
  }

  const isValid = timingSafeEqual(
    Buffer.from(providedKey),
    Buffer.from(configuredKey),
  );

  if (!isValid) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized.",
    });
  }

  next();
}
