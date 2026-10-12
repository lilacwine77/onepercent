export function environment(
  userAgent = navigator.userAgent,
  telegram = "TelegramWebviewProxy" in window,
  maxTouchPoints = navigator.maxTouchPoints ?? 0,
) {
  return {
    mobile:
      /Android|iPhone|iPad|iPod/i.test(userAgent) ||
      (/Macintosh/i.test(userAgent) && maxTouchPoints > 1),
    inApp: telegram || /Telegram/i.test(userAgent),
  };
}
