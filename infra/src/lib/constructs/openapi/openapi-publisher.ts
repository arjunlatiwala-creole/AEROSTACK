import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import * as fs from "fs";
import * as path from "path";

export interface OpenApiPublisherProps {
  openApiSpec: any;
  environment: string;
  /** @deprecated No longer used — bucket name is CDK-generated to avoid naming conflicts. */
  bucketPrefix?: string;
  writeLocalFile?: boolean;
  localOutputDir?: string;
  removalPolicy?: cdk.RemovalPolicy;
}

/**
 * Construct that handles OpenAPI spec generation and publishing
 **/
export class OpenApiPublisher extends Construct {
  public readonly bucket: s3.Bucket;
  public readonly localFilePath: string;
  public readonly s3Key: string;

  constructor(scope: Construct, id: string, props: OpenApiPublisherProps) {
    super(scope, id);

    const {
      openApiSpec,
      environment,
      writeLocalFile = true,
      localOutputDir = "openapi-specs",
      removalPolicy = cdk.RemovalPolicy.RETAIN,
    } = props;

    const openApiJson = JSON.stringify(openApiSpec, null, 2);
    this.s3Key = `openapi-${environment}.json`;

    // Write local file for development
    if (writeLocalFile) {
      this.localFilePath = this.writeLocalSpec(
        openApiJson,
        localOutputDir,
        environment
      );
    } else {
      this.localFilePath = "";
    }

    // Create S3 bucket — no explicit bucketName so CDK generates a unique one,
    // avoiding conflicts with pre-existing buckets of the same name.
    this.bucket = new s3.Bucket(this, "Bucket", {
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy,
      autoDeleteObjects: removalPolicy === cdk.RemovalPolicy.DESTROY,
    });

    // Upload to S3 directly from memory (no temp file needed!)
    new s3deploy.BucketDeployment(this, "Deploy", {
      sources: [
        s3deploy.Source.data(this.s3Key, openApiJson)
      ],
      destinationBucket: this.bucket,
      contentType: "application/json",
      prune: false,
    });

    this.createOutputs(environment);
  }

  private writeLocalSpec(
    openApiJson: string,
    localOutputDir: string,
    environment: string
  ): string {
    const outputDir = path.join(process.cwd(), localOutputDir);
    const filePath = path.join(outputDir, `openapi-${environment}.json`);

    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      fs.writeFileSync(filePath, openApiJson, "utf8");
      console.log(`✅ OpenAPI spec written to: ${filePath}`);
    } catch (error) {
      console.warn(`⚠️  Could not write local OpenAPI file: ${error}`);
    }

    return filePath;
  }

  private createOutputs(environment: string): void {
    new cdk.CfnOutput(this, "BucketName", {
      value: this.bucket.bucketName,
      description: "S3 bucket containing the OpenAPI spec",
    });

    new cdk.CfnOutput(this, "S3Uri", {
      value: `s3://${this.bucket.bucketName}/${this.s3Key}`,
      description: "S3 URI of the OpenAPI spec",
    });

    if (this.localFilePath) {
      new cdk.CfnOutput(this, "LocalFile", {
        value: this.localFilePath,
        description: "Local file path of the OpenAPI spec",
      });
    }
  }
}
