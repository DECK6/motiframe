import type { EditTransaction } from "./commands";
import { fail, ok, type Result } from "./result";
import type { Channel, Keyframe } from "./schema";
export function checkChannelEdit(channel: Channel, author: EditTransaction["author"]): Result<void> {
  if (channel.locked) return fail("LOCKED", "Channel is locked", [channel.target.instanceId]);
  if (author === "recipe" && channel.owner !== "recipe")
    return fail("OWNERSHIP_CONFLICT", "Recipe cannot edit a manual channel", [channel.target.instanceId]);
  return ok(undefined);
}
export function upsertKeyframe(keys: Keyframe[], key: Keyframe): Result<Keyframe[]> {
  if (keys.some((k) => k.id !== key.id && k.at === key.at))
    return fail("DUPLICATE_KEY_TIME", "Two keys cannot occupy one tick", [key.id]);
  return ok([...keys.filter((k) => k.id !== key.id), structuredClone(key)].sort((a, b) => a.at - b.at));
}
