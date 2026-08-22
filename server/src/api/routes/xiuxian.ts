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
    type: z.enum(["move", "talk", "interact", "world_action", "meditate", "train", "use_skill", "choose"]),
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

router.get("/rooms", async (_req, res) => {
  await respond(res, () => xiuxianStoryService.listRooms());
});

router.get("/rooms/:roomId", async (req, res) => {
  await respond(res, () => xiuxianStoryService.getRoom(Id.parse(req.params.roomId)));
});

router.post("/rooms", async (req, res) => {
  await respond(res, () => xiuxianStoryService.createRoom(z.object({
    playerId: Id,
    displayName: z.string().trim().min(1).max(40),
    maxPlayers: z.number().int().min(2).max(100).optional(),
  }).parse(req.body)));
});

router.post("/rooms/:roomId/join", async (req, res) => {
  await respond(res, async () => {
    const input = z.object({
      playerId: Id,
      characterId: Id.nullish(),
      displayName: z.string().trim().min(1).max(40),
      role: z.enum(["companion", "rival", "sect_member", "observer"]),
    }).parse(req.body);
    if (input.characterId && !appContext.characterManager.getAllProfiles().some((item) => item.id === input.characterId)) {
      throw new Error("WorldX 世界中不存在该角色");
    }
    return xiuxianStoryService.joinRoom({ ...input, roomId: Id.parse(req.params.roomId) });
  });
});

router.post("/rooms/:roomId/reconnect", async (req, res) => {
  await respond(res, () => xiuxianStoryService.reconnectRoom({
    ...z.object({ playerId: Id, resumeToken: Id }).parse(req.body),
    roomId: Id.parse(req.params.roomId),
  }));
});

router.post("/rooms/:roomId/resume", async (req, res) => {
  await respond(res, () => xiuxianStoryService.resumeRoom({
    playerId: z.object({ playerId: Id }).parse(req.body).playerId,
    roomId: Id.parse(req.params.roomId),
  }));
});

router.post("/rooms/:roomId/intents", async (req, res) => {
  await respond(res, () => xiuxianStoryService.submitRoomIntent({
    ...z.object({
      playerId: Id,
      resumeToken: Id,
      clientSequence: z.number().int().positive(),
      intent: z.object({
        type: z.enum(["move", "talk", "interact", "world_action", "meditate", "train", "use_skill", "choose"]),
        targetId: Id.nullish(),
        payload: z.record(z.any()).optional(),
      }),
    }).parse(req.body),
    roomId: Id.parse(req.params.roomId),
  }));
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
