import { Router, type Response } from "express";
import { z } from "zod";
import { appContext } from "../../services/app-context.js";
import { xiuxianStoryService } from "../../modules/xiuxian-story-service.js";

const router = Router();
const Id = z.string().trim().min(1).max(128);

router.get("/status", async (_req, res) => {
  await respond(res, () => xiuxianStoryService.getStatus());
});

router.post("/protagonist/bind", async (req, res) => {
  await respond(res, async () => {
    const input = z.object({ playerId: Id, characterId: Id }).parse(req.body);
    const profile = appContext.characterManager.getAllProfiles().find((item) => item.id === input.characterId);
    if (!profile) throw new Error("WorldX 世界中不存在该角色");
    return xiuxianStoryService.bindProtagonist({ ...input, characterName: profile.name });
  });
});

router.post("/action", async (req, res) => {
  await respond(res, () => xiuxianStoryService.submitAction(z.object({
    playerId: Id,
    type: z.enum(["move", "talk", "world_action", "meditate", "train", "use_skill", "choose"]),
    targetId: Id.nullish(),
    payload: z.record(z.any()).optional(),
  }).parse(req.body)));
});

router.post("/breakthrough", async (req, res) => {
  await respond(res, () => xiuxianStoryService.attemptBreakthrough(z.object({ playerId: Id }).parse(req.body).playerId));
});

router.post("/techniques/:techniqueId/learn", async (req, res) => {
  await respond(res, () => xiuxianStoryService.learnTechnique(
    z.object({ playerId: Id }).parse(req.body).playerId,
    Id.parse(req.params.techniqueId),
  ));
});

router.post("/accidents/propose", async (req, res) => {
  await respond(res, () => {
    const time = appContext.worldManager.getCurrentTime();
    const worldTick = time.day * 100000 + time.tick;
    return xiuxianStoryService.proposeAccident(worldTick);
  });
});

router.post("/accidents/resolve", async (req, res) => {
  await respond(res, () => {
    const input = z.object({ playerId: Id, instanceId: Id, choiceId: Id }).parse(req.body);
    const time = appContext.worldManager.getCurrentTime();
    return xiuxianStoryService.resolveAccident({ ...input, worldTick: time.day * 100000 + time.tick });
  });
});

async function respond(res: Response, work: () => Promise<unknown>) {
  try {
    res.json(await work());
  } catch (error) {
    const message = error instanceof Error ? error.message : "修仙模块请求失败";
    res.status(400).json({ error: message });
  }
}

export default router;
