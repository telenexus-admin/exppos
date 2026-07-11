import argon2 from "argon2";

const options = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

export const hashSecret = (value: string) => argon2.hash(value, options);
export const verifySecret = (hash: string, value: string) => argon2.verify(hash, value);

export function assertStrongPassword(value: string): void {
  if (value.length < 12 || !/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) {
    throw new Error("Password must be at least 12 characters and contain upper, lower, and numeric characters");
  }
}
