import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import { Construct } from "constructs";
import type { IApiAuth } from "../../constructs/auth/cognito-auth";

export interface OpenApiConstructProps {
  api: apigw.RestApi;
  bucket: s3.IBucket;
  s3Key: string;
  auth: IApiAuth;
  lambdaDefaults: Omit<nodejs.NodejsFunctionProps, "entry" | "handler">;
}

export class OpenApiConstruct extends Construct {
  constructor(scope: Construct, id: string, props: OpenApiConstructProps) {
    super(scope, id);

    const createFunction = (
      id: string,
      entry: string,
      handler: string
    ): nodejs.NodejsFunction =>
      new nodejs.NodejsFunction(this, id, {
        ...props.lambdaDefaults,
        entry,
        handler,
        environment: {
                 OPENAPI_BUCKET: props.bucket.bucketName,
                 OPENAPI_KEY: props.s3Key,
                 ...props.lambdaDefaults.environment,
               },

      });

    const getDocs = createFunction(
      "GetDocs",
      "src/functions/openapi/get-docs.ts",
      "getDocs"
    );

    props.bucket.grantRead(getDocs);


    const openApiResource = props.api.root.addResource("openapi");
    openApiResource.addMethod(
      "GET",
      new apigw.LambdaIntegration(getDocs),
      {
        authorizationType: apigw.AuthorizationType.COGNITO,
        authorizer: props.auth.authorizer,
      }
    );
  }
}
