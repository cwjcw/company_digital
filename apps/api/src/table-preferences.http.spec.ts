import "reflect-metadata";
import { Controller, INestApplication, Put } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AuthController } from "./controllers";
import { AuthGuard, AuthService } from "./auth";
import { ModificationContextInterceptor } from "./modification-audit";

@Controller("business")
class BusinessController {
  @Put() update() { return { saved: true }; }
}

describe("table preferences through the production audit interceptor", () => {
  let app: INestApplication;
  const auth = { saveTablePreference: jest.fn().mockImplementation(async (_user, _resource, _view, _type, config) => ({ config })) };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [AuthController, BusinessController], providers: [{ provide: AuthService, useValue: auth }] })
      .overrideGuard(AuthGuard).useValue({ canActivate: (context: any) => { context.switchToHttp().getRequest().user = { sub: "authenticated-user" }; return true; } }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new ModificationContextInterceptor());
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => auth.saveTablePreference.mockClear());

  it.each(["createdAt", "createdBy", "updatedAt", "updatedBy"])("accepts numeric %s column widths without assigning audit values", async (field) => {
    const config = { version: 1, visibleFieldKeys: [field], orderedFieldKeys: [field], columnWidths: { [field]: 175 }, pinnedFieldKeys: [] };
    await request(app.getHttpServer()).put("/auth/preferences/table-config").send({ resource: "projects", configType: "DISPLAY", config, ifMissing: true }).expect(200);
    expect(auth.saveTablePreference).toHaveBeenCalledWith("authenticated-user", "projects", undefined, "DISPLAY", config, undefined, true);
  });

  it.each([
    { createdAt: "forged" },
    { config: { createdAt: "forged" } },
    { config: { columnWidths: { createdAt: "forged" } } },
    { config: { columnWidths: { nested: { updatedBy: "forged" } } } }
  ])("continues to reject actual audit assignments: %j", async (body) => {
    await request(app.getHttpServer()).put("/auth/preferences/table-config").send(body).expect(400);
    expect(auth.saveTablePreference).not.toHaveBeenCalled();
  });

  it("does not grant the preference exception to business commands", async () => {
    await request(app.getHttpServer()).put("/business").send({ config: { columnWidths: { createdAt: 175 } } }).expect(400);
  });
});
