import { SquidService, executable, webhook } from '@squidcloud/backend';

/**
 * Test Service
 * Simple service to verify backend HMR and webhook functionality
 */
export class TestService extends SquidService {
  
  @executable()
  async testPing(): Promise<{ message: string; timestamp: string; service: string }> {
    console.log('🔔 TestService.testPing() called at', new Date().toISOString());
    return {
      message: 'TestService is alive!',
      timestamp: new Date().toISOString(),
      service: 'TestService'
    };
  }

  @executable()
  async testEcho(data: any): Promise<{ echoed: any; timestamp: string }> {
    console.log('🔔 TestService.testEcho() called with:', data);
    return {
      echoed: data,
      timestamp: new Date().toISOString()
    };
  }

  @webhook('test-webhook')
  handleTestWebhook(request: any): object {
    const response = {
      message: 'Test webhook received!',
      receivedData: request,
      timestamp: new Date().toISOString(),
      service: 'TestService'
    };
    console.log('🪝 TestService webhook called:', response);
    return response;
  }
}

