// Generated from main.eff by the Effektive compiler. Do not edit.

import { Effect, Layer } from "effect";
import { Name, StoreUnavailable, Users } from "./users-service.ts";
import { displayName } from "./users.ts";
import { UsersLive } from "./users-live.ts";

const UsersLive$host: Layer.Layer<Users> = UsersLive;

export const main = (): Effect.Effect<Name, StoreUnavailable> =>
  Effect.provide(Effect.suspend(() => displayName("u1")), UsersLive$host);
//# sourceMappingURL=main.ts.map
