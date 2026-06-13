import fs from 'fs'
import path from 'path'

const pages = ['Login', 'Assessments', 'LessonPlans', 'Batches', 'Email', 'Timetable', 'Wellness']

for (const name of pages) {
  const src = path.join('src/pages', `${name}.jsx`)
  const dest = path.join('src/pages', `${name}.tsx`)
  let content = fs.readFileSync(src, 'utf8')
  content = content.replace(/from '([^']+)\.jsx'/g, "from '$1'")
  content = content.replace(/from '([^']+)\.js'/g, "from '$1'")
  fs.writeFileSync(dest, content)
  console.log('Converted', name)
}
