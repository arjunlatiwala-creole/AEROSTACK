"""EventBridge entry for scheduled LinkedIn publish (reuse content handler logic)."""


def handler(event, context):  # noqa: ARG001
    import handler as content_handler

    return content_handler.process_scheduled_linkedin_posts()
