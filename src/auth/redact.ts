/** Replace known secret values so they never land in errors or logs. */
export function redactSecrets(text: string, secrets: Array<string | undefined>): string {
  let output = text;
  const unique = [...new Set(secrets.filter((value): value is string => Boolean(value && value.length >= 4)))];
  unique.sort((a, b) => b.length - a.length);
  for (const secret of unique) {
    output = output.split(secret).join("[redacted]");
  }
  return output;
}
