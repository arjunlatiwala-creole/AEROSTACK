import { SquidService, executable } from "@squidcloud/backend";
import {
  SQSClient,
  SendMessageCommand,
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  DeleteMessageBatchCommand,
  GetQueueAttributesCommand,
  type Message,
  type SendMessageCommandInput,
  type SendMessageBatchRequestEntry,
} from "@aws-sdk/client-sqs";

/**
 * SQS Service - AWS Simple Queue Service Integration
 *
 * Manages message queuing using AWS SQS for:
 * - Async job processing
 * - Agent communication
 * - Event-driven workflows
 * - Decoupled microservices communication
 *
 * Replaces RabbitMQ with AWS SQS for better cloud-native integration
 */
export class SQSService extends SquidService {
  private client: SQSClient;
  private queueUrl: string;
  private dlqUrl?: string;

  constructor() {
    super();

    // Initialize SQS client
    this.client = new SQSClient({
      region: process.env.AWS_REGION || "us-east-1",
      credentials:
        process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            }
          : undefined, // Use default credential provider chain if not specified
    });

    this.queueUrl = process.env.AWS_SQS_QUEUE_URL || "";
    this.dlqUrl = process.env.AWS_SQS_DLQ_URL;

    if (!this.queueUrl) {
      console.warn(
        "⚠️  AWS_SQS_QUEUE_URL not configured. SQS service will not function."
      );
    } else {
      console.log("✅ SQS Service initialized:", this.queueUrl);
    }
  }

  // =============================================
  // Send Messages
  // =============================================

  /**
   * Send a single message to the queue
   */
  @executable()
  async sendMessage(params: {
    messageBody: any;
    messageGroupId?: string; // For FIFO queues
    deduplicationId?: string; // For FIFO queues
    delaySeconds?: number; // 0-900 seconds
    messageAttributes?: Record<
      string,
      { DataType: string; StringValue: string }
    >;
  }): Promise<{ messageId: string; success: boolean; error?: string }> {
    try {
      if (!this.queueUrl) {
        throw new Error("SQS queue URL not configured");
      }

      const messageBody =
        typeof params.messageBody === "string"
          ? params.messageBody
          : JSON.stringify(params.messageBody);

      const input: SendMessageCommandInput = {
        QueueUrl: this.queueUrl,
        MessageBody: messageBody,
        DelaySeconds: params.delaySeconds,
        MessageAttributes: params.messageAttributes,
      };

      // Add FIFO-specific parameters if provided
      if (params.messageGroupId) {
        input.MessageGroupId = params.messageGroupId;
      }
      if (params.deduplicationId) {
        input.MessageDeduplicationId = params.deduplicationId;
      }

      const command = new SendMessageCommand(input);
      const response = await this.client.send(command);

      console.log("✅ Message sent to SQS:", response.MessageId);

      return {
        messageId: response.MessageId || "",
        success: true,
      };
    } catch (error: any) {
      console.error("❌ Error sending message to SQS:", error);
      return {
        messageId: "",
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send multiple messages in batch (up to 10 messages)
   */
  @executable()
  async sendMessageBatch(params: {
    messages: Array<{
      id: string;
      messageBody: any;
      messageGroupId?: string;
      deduplicationId?: string;
      delaySeconds?: number;
    }>;
  }): Promise<{
    successful: number;
    failed: number;
    results: Array<{
      id: string;
      messageId?: string;
      success: boolean;
      error?: string;
    }>;
  }> {
    try {
      if (!this.queueUrl) {
        throw new Error("SQS queue URL not configured");
      }

      if (params.messages.length > 10) {
        throw new Error("Cannot send more than 10 messages in a single batch");
      }

      const entries: SendMessageBatchRequestEntry[] = params.messages.map(
        (msg) => ({
          Id: msg.id,
          MessageBody:
            typeof msg.messageBody === "string"
              ? msg.messageBody
              : JSON.stringify(msg.messageBody),
          DelaySeconds: msg.delaySeconds,
          MessageGroupId: msg.messageGroupId,
          MessageDeduplicationId: msg.deduplicationId,
        })
      );

      const command = new SendMessageBatchCommand({
        QueueUrl: this.queueUrl,
        Entries: entries,
      });

      const response = await this.client.send(command);

      const results = params.messages.map((msg) => {
        const success = response.Successful?.find((s) => s.Id === msg.id);
        const failed = response.Failed?.find((f) => f.Id === msg.id);

        return {
          id: msg.id,
          messageId: success?.MessageId,
          success: !!success,
          error: failed?.Message,
        };
      });

      console.log(
        `✅ Batch sent: ${response.Successful?.length || 0} successful, ${
          response.Failed?.length || 0
        } failed`
      );

      return {
        successful: response.Successful?.length || 0,
        failed: response.Failed?.length || 0,
        results,
      };
    } catch (error: any) {
      console.error("❌ Error sending batch to SQS:", error);
      throw error;
    }
  }

  // =============================================
  // Receive & Process Messages
  // =============================================

  /**
   * Receive messages from the queue
   */
  @executable()
  async receiveMessages(
    params: {
      maxMessages?: number; // 1-10
      waitTimeSeconds?: number; // Long polling (0-20)
      visibilityTimeout?: number; // How long message is hidden (0-43200)
    } = {}
  ): Promise<{
    messages: Array<{
      messageId: string;
      receiptHandle: string;
      body: any;
      attributes?: Record<string, string>;
      messageAttributes?: Record<string, any>;
    }>;
    count: number;
  }> {
    try {
      if (!this.queueUrl) {
        throw new Error("SQS queue URL not configured");
      }

      const command = new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: Math.min(params.maxMessages || 10, 10),
        WaitTimeSeconds: params.waitTimeSeconds || 0,
        VisibilityTimeout: params.visibilityTimeout,
        AttributeNames: ["All"],
        MessageAttributeNames: ["All"],
      });

      const response = await this.client.send(command);
      const messages = response.Messages || [];

      const formattedMessages = messages.map((msg: Message) => {
        let body: any;
        try {
          body = JSON.parse(msg.Body || "{}");
        } catch {
          body = msg.Body;
        }

        return {
          messageId: msg.MessageId || "",
          receiptHandle: msg.ReceiptHandle || "",
          body,
          attributes: msg.Attributes,
          messageAttributes: msg.MessageAttributes,
        };
      });

      console.log(`📨 Received ${formattedMessages.length} messages from SQS`);

      return {
        messages: formattedMessages,
        count: formattedMessages.length,
      };
    } catch (error: any) {
      console.error("❌ Error receiving messages from SQS:", error);
      return {
        messages: [],
        count: 0,
      };
    }
  }

  /**
   * Delete a message after processing
   */
  @executable()
  async deleteMessage(
    receiptHandle: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.queueUrl) {
        throw new Error("SQS queue URL not configured");
      }

      const command = new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      });

      await this.client.send(command);

      console.log("✅ Message deleted from SQS");

      return { success: true };
    } catch (error: any) {
      console.error("❌ Error deleting message from SQS:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Delete multiple messages in batch (up to 10)
   */
  @executable()
  async deleteMessageBatch(params: {
    messages: Array<{ id: string; receiptHandle: string }>;
  }): Promise<{
    successful: number;
    failed: number;
    results: Array<{ id: string; success: boolean; error?: string }>;
  }> {
    try {
      if (!this.queueUrl) {
        throw new Error("SQS queue URL not configured");
      }

      if (params.messages.length > 10) {
        throw new Error(
          "Cannot delete more than 10 messages in a single batch"
        );
      }

      const command = new DeleteMessageBatchCommand({
        QueueUrl: this.queueUrl,
        Entries: params.messages.map((msg) => ({
          Id: msg.id,
          ReceiptHandle: msg.receiptHandle,
        })),
      });

      const response = await this.client.send(command);

      const results = params.messages.map((msg) => {
        const success = response.Successful?.find((s) => s.Id === msg.id);
        const failed = response.Failed?.find((f) => f.Id === msg.id);

        return {
          id: msg.id,
          success: !!success,
          error: failed?.Message,
        };
      });

      console.log(
        `✅ Batch deleted: ${response.Successful?.length || 0} successful, ${
          response.Failed?.length || 0
        } failed`
      );

      return {
        successful: response.Successful?.length || 0,
        failed: response.Failed?.length || 0,
        results,
      };
    } catch (error: any) {
      console.error("❌ Error deleting batch from SQS:", error);
      throw error;
    }
  }

  // =============================================
  // Queue Monitoring & Management
  // =============================================

  /**
   * Get queue statistics and attributes
   */
  @executable()
  async getQueueStats(): Promise<{
    approximateMessages: number;
    approximateMessagesNotVisible: number;
    approximateMessagesDelayed: number;
    queueArn: string;
    createdTimestamp: string;
    lastModifiedTimestamp: string;
  } | null> {
    try {
      if (!this.queueUrl) {
        throw new Error("SQS queue URL not configured");
      }

      const command = new GetQueueAttributesCommand({
        QueueUrl: this.queueUrl,
        AttributeNames: ["All"],
      });

      const response = await this.client.send(command);
      const attrs = response.Attributes || {};

      return {
        approximateMessages: parseInt(attrs.ApproximateNumberOfMessages || "0"),
        approximateMessagesNotVisible: parseInt(
          attrs.ApproximateNumberOfMessagesNotVisible || "0"
        ),
        approximateMessagesDelayed: parseInt(
          attrs.ApproximateNumberOfMessagesDelayed || "0"
        ),
        queueArn: attrs.QueueArn || "",
        createdTimestamp: attrs.CreatedTimestamp || "",
        lastModifiedTimestamp: attrs.LastModifiedTimestamp || "",
      };
    } catch (error: any) {
      console.error("❌ Error getting queue stats:", error);
      return null;
    }
  }

  /**
   * Process messages with a handler function
   * This is a convenience method for implementing queue workers
   */
  async processMessages(
    handler: (message: any) => Promise<boolean>,
    options: {
      maxMessages?: number;
      waitTimeSeconds?: number;
      visibilityTimeout?: number;
      deleteOnSuccess?: boolean;
    } = {}
  ): Promise<{ processed: number; succeeded: number; failed: number }> {
    const { deleteOnSuccess = true } = options;

    const result = await this.receiveMessages({
      maxMessages: options.maxMessages,
      waitTimeSeconds: options.waitTimeSeconds,
      visibilityTimeout: options.visibilityTimeout,
    });

    let succeeded = 0;
    let failed = 0;

    for (const message of result.messages) {
      try {
        const success = await handler(message.body);

        if (success && deleteOnSuccess) {
          await this.deleteMessage(message.receiptHandle);
          succeeded++;
        } else if (!success) {
          failed++;
        }
      } catch (error: any) {
        console.error("❌ Error processing message:", error);
        failed++;
      }
    }

    console.log(
      `📊 Processed ${result.count} messages: ${succeeded} succeeded, ${failed} failed`
    );

    return {
      processed: result.count,
      succeeded,
      failed,
    };
  }
}
