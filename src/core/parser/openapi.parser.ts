import YAML from 'yaml';
import type { DocumentParser, ParsedDocument } from './parser.interface';
import type { OpenAPIMetadata } from '../../models/types';

/**
 * Parser for OpenAPI/Swagger specification files
 * Supports both YAML and JSON formats
 */
export class OpenAPIParser implements DocumentParser {
  /**
   * Check if content appears to be an OpenAPI specification
   */
  canParse(input: Buffer | string, fileName?: string): boolean {
    // Check file extension
    if (fileName) {
      const lowerName = fileName.toLowerCase();
      if (lowerName.endsWith('.yaml') || lowerName.endsWith('.yml') || 
          lowerName.endsWith('.json')) {
        // Could be OpenAPI, check content
        return this.hasOpenAPIContent(input);
      }
    }
    
    // Check content for OpenAPI indicators
    return this.hasOpenAPIContent(input);
  }

  /**
   * Parse OpenAPI content and extract metadata
   */
  async parse(input: Buffer | string): Promise<ParsedDocument> {
    const content = this.bufferToString(input);
    
    // Parse YAML or JSON
    let spec: Record<string, unknown>;
    try {
      spec = YAML.parse(content);
    } catch {
      // Try JSON if YAML fails
      try {
        spec = JSON.parse(content);
      } catch (error) {
        throw new Error('Invalid OpenAPI format: not valid YAML or JSON');
      }
    }

    // Validate OpenAPI version
    const version = this.extractVersion(spec);
    if (!version) {
      throw new Error('Invalid OpenAPI: missing version (openapi or swagger field)');
    }

    // Extract metadata
    const title = this.extractTitle(spec);
    const serverUrls = this.extractServers(spec);
    const { endpointCount, schemaCount } = this.countEndpointsAndSchemas(spec);

    const metadata: OpenAPIMetadata = {
      version,
      title: title || 'Untitled API',
      endpointCount,
      schemaCount,
      serverUrls,
    };

    // Format content for indexing
    const formattedContent = this.formatContent(spec);

    return {
      content: formattedContent,
      metadata,
      title,
    };
  }

  /**
   * Check if content contains OpenAPI indicators
   */
  private hasOpenAPIContent(input: Buffer | string): boolean {
    const content = this.bufferToString(input).slice(0, 1000); // Check first 1000 chars
    
    // Check for OpenAPI version indicators
    return (
      content.includes('openapi:') ||
      content.includes('"openapi"') ||
      content.includes('swagger:') ||
      content.includes('"swagger"')
    );
  }

  /**
   * Convert input to string
   */
  private bufferToString(input: Buffer | string): string {
    if (Buffer.isBuffer(input)) {
      return input.toString('utf-8');
    }
    return input;
  }

  /**
   * Extract OpenAPI version from spec
   */
  private extractVersion(spec: Record<string, unknown>): string | undefined {
    // OpenAPI 3.x
    if (spec.openapi && typeof spec.openapi === 'string') {
      return spec.openapi;
    }
    // Swagger 2.0
    if (spec.swagger && typeof spec.swagger === 'string') {
      return spec.swagger;
    }
    return undefined;
  }

  /**
   * Extract API title from spec
   */
  private extractTitle(spec: Record<string, unknown>): string | undefined {
    const info = spec.info as Record<string, unknown> | undefined;
    if (info && typeof info.title === 'string') {
      return info.title;
    }
    return undefined;
  }

  /**
   * Extract server URLs from spec
   */
  private extractServers(spec: Record<string, unknown>): string[] {
    const urls: string[] = [];
    
    // OpenAPI 3.x servers
    if (Array.isArray(spec.servers)) {
      for (const server of spec.servers) {
        if (typeof server === 'object' && server !== null && 'url' in server) {
          urls.push(String(server.url));
        }
      }
    }
    
    // Swagger 2.0 host + basePath
    if (spec.host) {
      const scheme = Array.isArray(spec.schemes) ? spec.schemes[0] : 'https';
      const basePath = typeof spec.basePath === 'string' ? spec.basePath : '';
      urls.push(`${scheme}://${spec.host}${basePath}`);
    }
    
    return urls;
  }

  /**
   * Count endpoints and schemas in the spec
   */
  private countEndpointsAndSchemas(spec: Record<string, unknown>): {
    endpointCount: number;
    schemaCount: number;
  } {
    let endpointCount = 0;
    let schemaCount = 0;

    // Count endpoints from paths
    const paths = spec.paths as Record<string, Record<string, unknown>> | undefined;
    if (paths && typeof paths === 'object') {
      for (const path of Object.values(paths)) {
        if (typeof path === 'object' && path !== null) {
          // Count HTTP methods
          const methods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];
          for (const method of methods) {
            if (method in path) {
              endpointCount++;
            }
          }
        }
      }
    }

    // Count schemas
    const components = spec.components as Record<string, unknown> | undefined;
    if (components && typeof components === 'object') {
      const schemas = components.schemas as Record<string, unknown> | undefined;
      if (schemas && typeof schemas === 'object') {
        schemaCount = Object.keys(schemas).length;
      }
    }

    // Swagger 2.0 definitions
    const definitions = spec.definitions as Record<string, unknown> | undefined;
    if (definitions && typeof definitions === 'object') {
      schemaCount = Object.keys(definitions).length;
    }

    return { endpointCount, schemaCount };
  }

  /**
   * Format OpenAPI spec as readable text for indexing
   */
  private formatContent(spec: Record<string, unknown>): string {
    const lines: string[] = [];
    
    // Add title and description
    const info = spec.info as Record<string, unknown> | undefined;
    if (info) {
      if (info.title) {
        lines.push(`# ${info.title}`);
      }
      if (info.description) {
        lines.push(String(info.description));
      }
      if (info.version) {
        lines.push(`Version: ${info.version}`);
      }
      lines.push('');
    }

    // Add endpoints
    const paths = spec.paths as Record<string, Record<string, unknown>> | undefined;
    if (paths) {
      lines.push('## Endpoints');
      lines.push('');
      
      for (const [path, methods] of Object.entries(paths)) {
        if (typeof methods === 'object' && methods !== null) {
          for (const [method, operation] of Object.entries(methods)) {
            if (typeof operation === 'object' && operation !== null) {
              const op = operation as Record<string, unknown>;
              lines.push(`### ${method.toUpperCase()} ${path}`);
              if (op.summary) {
                lines.push(`Summary: ${op.summary}`);
              }
              if (op.description) {
                lines.push(String(op.description));
              }
              lines.push('');
            }
          }
        }
      }
    }

    return lines.join('\n');
  }
}
