/** This guard runs before env parsing and deliberately imports no service toolkit. */
export class KeyVariableError extends Error {
  constructor(readonly variable: string) {
    super(variable);
  }
}
export function assertBotKeyIsolation(env: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(env)) {
    if (/(?:_KEYPAIR$|PRIVATE_KEY|SECRET_KEY|MNEMONIC|SEED_PHRASE)/i.test(name))
      throw new KeyVariableError(name);
  }
}
