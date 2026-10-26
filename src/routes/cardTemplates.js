import express from "express";
import CardTemplateController from "../controllers/cardTemplates.js";

const router = express.Router();

router.get("/", CardTemplateController.getAllDesigns);
router.get("/:id", CardTemplateController.getDesignById);
router.put("/:id", CardTemplateController.editDesign);
router.delete("/:id", CardTemplateController.deleteDesign);

export default router;