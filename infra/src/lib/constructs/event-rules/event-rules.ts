import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cw_actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import * as sns from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";

/**
 * Scheduled ingestion config for a single integration type.
 * The fanout Lambda is invoked twice daily with this payload shape,
 * which mirrors the ManualSyncDetail type expected by manual-sync-fanout.ts.
 */
export interface ScheduledIngestionConfig {
	/** integration_type value forwarded to the fanout Lambda (e.g. "hubspot") */
	integrationType: string;
}

export interface EventRulesProps {
	manualSyncFanoutLambda: lambda.IFunction;
	ingestionLambdas: Record<string, lambda.IFunction>;
	processingLambdas: Record<string, lambda.IFunction>;
	unifiedProcessingLambda?: lambda.IFunction;
	/**
	 * When provided, creates twice-daily EventBridge cron rules (6 AM and 6 PM
	 * US Eastern, expressed as 11:00 and 23:00 UTC) that invoke the
	 * manualSyncFanoutLambda for each listed integration type.
	 * A CloudWatch alarm is also created per ingestion Lambda.
	 */
	scheduledIngestions?: ScheduledIngestionConfig[];
	/** Stack prefix used for naming CloudWatch alarms (e.g. "aerostack-dev"). */
	prefix?: string;
}

export class EventRules extends Construct {
	constructor(scope: Construct, id: string, props: EventRulesProps) {
		super(scope, id);

		/* ------------------------------------------------------------------ */
		/* Rule 1: Manual Sync Requested → Fanout                             */
		/* ------------------------------------------------------------------ */
		new events.Rule(this, "ManualSyncRequestedRule", {
			eventPattern: {
				source: ["manual.sync"],
				detailType: ["Manual Sync Requested"],
			},
			targets: [new targets.LambdaFunction(props.manualSyncFanoutLambda)],
		});

		/* ------------------------------------------------------------------ */
		/* Rule 2: Ingest Requested → Ingestion Lambda (per integration_type) */
		/* ------------------------------------------------------------------ */
		for (const [integrationType, lambdaFn] of Object.entries(
			props.ingestionLambdas,
		)) {
			new events.Rule(this, `IngestRequested-${integrationType}`, {
				eventPattern: {
					source: ["integration.ingest"],
					detailType: ["Ingest Requested"],
					detail: {
						integration_type: [integrationType],
					},
				},
				targets: [new targets.LambdaFunction(lambdaFn)],
			});
		}

		/* ------------------------------------------------------------------ */
		/* Rule 3: Ingestion Complete → Processing Lambda (per type)          */
		/* ------------------------------------------------------------------ */
		for (const [integrationType, lambdaFn] of Object.entries(
			props.processingLambdas,
		)) {
			new events.Rule(this, `ProcessEntity-${integrationType}`, {
				eventPattern: {
					source: ["integration.ingest"],
					detailType: ["Ingestion Complete"],
					detail: {
						integration_type: [integrationType],
					},
				},
				targets: [new targets.LambdaFunction(lambdaFn)],
			});
		}

		/* ------------------------------------------------------------------ */
		/* Rule 4: Ingestion Complete → Unified Processing Lambda             */
		/* ------------------------------------------------------------------ */
		if (props.unifiedProcessingLambda) {
			new events.Rule(this, "UnifiedProcess-hubspot", {
				eventPattern: {
					source: ["integration.ingest"],
					detailType: ["Ingestion Complete"],
					detail: {
						integration_type: ["hubspot"],
					},
				},
				targets: [new targets.LambdaFunction(props.unifiedProcessingLambda)],
			});

			new events.Rule(this, "UnifiedProcess-partner_central", {
				eventPattern: {
					source: ["integration.ingest"],
					detailType: ["Ingestion Complete"],
					detail: {
						integration_type: ["partner_central"],
					},
				},
				targets: [new targets.LambdaFunction(props.unifiedProcessingLambda)],
			});
		}

		/* ------------------------------------------------------------------ */
		/* Rule 5 (new): Scheduled twice-daily ingestion                      */
		/*                                                                    */
		/* 6 AM US Eastern  = 11:00 UTC  (exact in EST; 1hr off in EDT)      */
		/* 6 PM US Eastern  = 23:00 UTC  (exact in EST; 1hr off in EDT)      */
		/*                                                                    */
		/* Each rule invokes manualSyncFanoutLambda with a static payload     */
		/* shaped like ManualSyncDetail. The fanout then emits one            */
		/* "Ingest Requested" event per entity for that integration type,     */
		/* which the existing Rule 2 routes to the correct ingestion Lambda.  */
		/* ------------------------------------------------------------------ */
		if (props.scheduledIngestions && props.scheduledIngestions.length > 0) {
			// Shared SNS topic for all ingestion error alarms in this construct
			const alarmTopic = new sns.Topic(this, "IngestionAlarmTopic", {
				displayName: `${props.prefix ?? "aerostack"}-ingestion-errors`,
			});

			for (const cfg of props.scheduledIngestions) {
				const { integrationType } = cfg;

				// Static event payload — mirrors ManualSyncDetail in manual-sync-fanout.ts
				const scheduledPayload = {
					"detail-type": "Manual Sync Requested",
					source: "scheduled.sync",
					detail: {
						integration_type: integrationType,
						integration_id: `scheduled-${integrationType}`,
						trigger: "manual" as const,
						triggered_by: "eventbridge-schedule",
						requested_at: events.EventField.fromPath("$.time"),
					},
				};

				// 6 AM US Eastern (11:00 UTC)
				new events.Rule(this, `ScheduledIngest-${integrationType}-AM`, {
					ruleName: `${props.prefix ?? "aerostack"}-scheduled-ingest-${integrationType}-am`,
					description: `Scheduled 6 AM US Eastern ingestion for ${integrationType}`,
					schedule: events.Schedule.cron({
						minute: "0",
						hour: "11",
						day: "*",
						month: "*",
						year: "*",
					}),
					targets: [
						new targets.LambdaFunction(props.manualSyncFanoutLambda, {
							event: events.RuleTargetInput.fromObject(scheduledPayload),
						}),
					],
				});

				// 6 PM US Eastern (23:00 UTC)
				new events.Rule(this, `ScheduledIngest-${integrationType}-PM`, {
					ruleName: `${props.prefix ?? "aerostack"}-scheduled-ingest-${integrationType}-pm`,
					description: `Scheduled 6 PM US Eastern ingestion for ${integrationType}`,
					schedule: events.Schedule.cron({
						minute: "0",
						hour: "23",
						day: "*",
						month: "*",
						year: "*",
					}),
					targets: [
						new targets.LambdaFunction(props.manualSyncFanoutLambda, {
							event: events.RuleTargetInput.fromObject(scheduledPayload),
						}),
					],
				});

				// CloudWatch alarm: alert if the ingestion Lambda errors in a 5-min window
				const ingestionLambda = props.ingestionLambdas[integrationType];
				if (ingestionLambda) {
					const alarm = new cloudwatch.Alarm(
						this,
						`IngestionErrorAlarm-${integrationType}`,
						{
							alarmName: `${props.prefix ?? "aerostack"}-ingestion-errors-${integrationType}`,
							alarmDescription: `${integrationType} ingestion Lambda has errors`,
							metric: ingestionLambda.metricErrors({
								period: cdk.Duration.minutes(5),
								statistic: "Sum",
							}),
							threshold: 1,
							evaluationPeriods: 1,
							comparisonOperator:
								cloudwatch.ComparisonOperator
									.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
							treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
						},
					);

					alarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));
				}
			}
		}
	}
}
