// Generated from users.eff by the Effektive compiler. Do not edit.

import { Effect, Option } from "effect";
import {
  Name,
  StoreUnavailable,
  User,
  UserId,
  UserMissing,
  Users,
} from "./users-service.ts";

export const getUser = (id: UserId): Effect.Effect<
  User,
  StoreUnavailable | UserMissing,
  Users
> =>
  Effect.gen(function* () {
    return yield* Option.match(yield* Users.use(($s) => $s.find(id)), {
      onNone: () => Effect.fail(new UserMissing({ id })),
      onSome: (user) => Effect.succeed(user),
    });
  });

export const rename = (id: UserId, name: Name): Effect.Effect<
  User,
  StoreUnavailable | UserMissing,
  Users
> =>
  Effect.gen(function* () {
    const user: User = yield* getUser(id);
    const renamed: User = { ...user, name };
    yield* Users.use(($s) => $s.save(renamed));
    return renamed;
  });

export const displayName = (id: UserId): Effect.Effect<
  Name,
  StoreUnavailable,
  Users
> =>
  Effect.gen(function* () {
    return (yield* getUser(id)).name;
  }).pipe(
    Effect.catchTags({
      "users-service#UserMissing": (error) => Effect.succeed("Guest"),
    }),
  );

export const activeNames = (): Effect.Effect<
  ReadonlyArray<Name>,
  StoreUnavailable,
  Users
> =>
  Effect.gen(function* () {
    const $p1: ReadonlyArray<User> = yield* Users.use(($s) => $s.all());
    const $p2: ReadonlyArray<User> = $p1.filter((user) => user.active);
    return $p2.map((user) => user.name);
  });
//# sourceMappingURL=users.ts.map
