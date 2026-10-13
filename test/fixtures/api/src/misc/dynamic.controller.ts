import { Controller } from '@nestjs/common'

const prefix = 'dynamic'

// Non-literal registration name: skipped
@Controller(prefix)
export class DynamicController {}
