import { Controller, Get } from '@nestjs/common'

const prefix = 'dynamic'

// Only the first class of a file is considered: this one has no @Controller() decorator, so the file is skipped
export class NotDecoratedController {
  @Get()
  ignored(): string {
    return 'skipped'
  }
}

@Controller(prefix)
export class DynamicPrefixController {}
