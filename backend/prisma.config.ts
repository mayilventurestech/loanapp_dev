import { definePrismaConfig } from "prisma/config";
import "dotenv/config";

export default definePrismaConfig({
  schema: "prisma/schema.prisma",
});