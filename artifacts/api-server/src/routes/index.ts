import { Router, type IRouter } from "express";
import healthRouter from "./health";
import conversationsRouter from "./conversations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(conversationsRouter);

export default router;
