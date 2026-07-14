import * as apigw from "aws-cdk-lib/aws-apigateway";
import { hubspotModels, ModelDef } from "./hubspot";

export class ModelRegistry {
  private models = new Map<string, apigw.Model>();

  constructor(private api: apigw.RestApi) {
    this.registerAll();
  }

  private registerAll() {
    Object.entries(hubspotModels).forEach(([key, def]) => {
      this.models.set(
        key,
        this.api.addModel(def.name, {
          contentType: "application/json",
          schema: def.schema,
        }),
      );
    });
  }

  get(key: string): apigw.Model {
    const model = this.models.get(key);
    if (!model) throw new Error(`Model ${key} not found`);
    return model;
  }
}
