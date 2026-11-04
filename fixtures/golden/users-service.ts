// Generated from users-service.eff by the Effektive compiler. Do not edit.

import { Context, Effect, Option, Schema } from "effect";

export const UserId = Schema.String;
export type UserId = typeof UserId.Type;

export const Name = Schema.String;
export type Name = typeof Name.Type;

export const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  active: Schema.Boolean,
});
export type User = typeof User.Type;

export class UserMissing extends Schema.TaggedError<UserMissing>()(
  "users-service#UserMissing",
  { id: Schema.String },
) {}

export class StoreUnavailable extends Schema.TaggedError<StoreUnavailable>()(
  "users-service#StoreUnavailable",
  { message: Schema.String },
) {}

export class Users extends Context.Service<Users, {
  readonly find: (a: UserId) => Effect.Effect<
    Option.Option<User>,
    StoreUnavailable
  >;
  readonly save: (a: User) => Effect.Effect<void, StoreUnavailable>;
  readonly all: () => Effect.Effect<ReadonlyArray<User>, StoreUnavailable>;
}>()("users-service#Users") {}
//# sourceMappingURL=users-service.ts.map
