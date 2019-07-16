'use strict';

// create data to migrate into DynamoDB

const faker = require('faker');
const jsonfile = require('jsonfile');
const fs = require('fs');
const csv = require('csv-parser');
require('colors');

const numRecruiters = 20;
const numCandidates = 10;

const users = [];

let zipCodes = [];
// import us post codes from database to zipCodes, then generate users data on the completion of importing zip codes
fs.createReadStream('us_postal_codes.csv')
  .pipe(csv())
  .on('data', data => {
    zipCodes.push(data['Zip Code']);
  })
  .on('end', () => {
    // generate users data to migrate
    for (let i = 0; i < numRecruiters; i++) {
      // seed recruiters
      const email = faker.internet.email();
      const user = {
        username: email,
        password: 'password123',
        email: email,
        family_name: faker.name.lastName(),
        given_name: faker.name.firstName(),
        phone_number: '+380123534015',
        'custom:zip':
          zipCodes[
            faker.random.number({
              min: 0,
              max: zipCodes.length - 1
            })
          ],
        'custom:isRecruiter': 1
      };
      users.push(user);
    }

    for (let i = 0; i < numCandidates; i++) {
      // seed candidates
      const email = faker.internet.email();
      const user = {
        username: email,
        password: 'password123',
        email: email,
        family_name: faker.name.lastName(),
        given_name: faker.name.firstName(),
        phone_number: '+380123534015',
        'custom:zip':
          zipCodes[
            faker.random.number({
              min: 0,
              max: zipCodes.length - 1
            })
          ],
        'custom:isRecruiter': 0
      };
      users.push(user);
    }

    // store users data in users.json file
    jsonfile.writeFile('users.json', users, error => {
      if (error) {
        console.error(error);
      } else {
        console.log('Completed seeding Users data!'.green);
      }
    });
  });

// generate industries to migrate
let industries = [];
const industryValues = ['IT', 'Food', 'Automobile'];
for (const industry of industryValues) {
  industries.push({
    id: faker.random.uuid(),
    value: industry,
    status: true //faker.random.boolean()
  });
}

// store industries in industries.json file
jsonfile.writeFile('industries.json', industries, error => {
  if (error) {
    console.error(error);
  } else {
    console.log('Completed seeding Industry data!'.green);
  }
});

// generate work types to migrate
let workTypes = [];
const workTypeValues = ['Part Time', 'Full Time', 'Extra Income', 'Summer Job', 'Internship', 'Seasonal', 'From Home'];
for (const workType of workTypeValues) {
  workTypes.push({
    id: faker.random.uuid(),
    value: workType,
    status: true //faker.random.boolean()
  });
}

// store work types in work-types.json file
jsonfile.writeFile('work-types.json', workTypes, error => {
  if (error) {
    console.error(error);
  } else {
    console.log('Completed seeding WorkType data!'.green);
  }
});

// generate career categories to migrate
let categories = [];
const categoryValues = ['Sales', 'Customer Service'];
var salesCategoryId, customerCategoryId;
for (const category of categoryValues) {
  let id = faker.random.uuid();
  if (category == 'Sales') {
    salesCategoryId = id;
  } else {
    customerCategoryId = id;
  }
  categories.push({
    id,
    value: category,
    status: true //faker.random.boolean()
  });
}

// store career categories in career-categories.json file
jsonfile.writeFile('career-categories.json', categories, error => {
  if (error) {
    console.error(error);
  } else {
    console.log('Completed seeding CareerCategory data!'.green);
  }
});

// generate CategoryType enum values to migrate
let categoryTypes = [];
const salesTypeValues = ['B2B', 'B2C', 'Call center', 'Outside Sales', 'Via Webcam', 'Phone Sales Only', 'In store retail', 'Seasonal'];
const customerTypeValues = ['IT', 'Customer Service', 'On Field', 'On Call'];
for (const value of salesTypeValues) {
  categoryTypes.push({
    id: faker.random.uuid(),
    value,
    status: true, //faker.random.boolean(),
    categoryId: salesCategoryId
  });
}

for (const value of customerTypeValues) {
  categoryTypes.push({
    id: faker.random.uuid(),
    value,
    status: true, //faker.random.boolean(),
    categoryId: customerCategoryId
  });
}

// store values in the file
jsonfile.writeFile('category-types.json', categoryTypes, error => {
  if (error) {
    console.error(error);
  } else {
    console.log('Completed seeding CategoryType data!'.green);
  }
});

// generate Salary Type enum values to migrate
let salaryTypes = [];
const salaryTypeValues = ['Hourly', 'Salary', 'Commission Only', '1099 VS Employee', 'Salary + Commission'];
for (const value of salaryTypeValues) {
  salaryTypes.push({
    id: faker.random.uuid(),
    value,
    status: true //faker.random.boolean()
  });
}

// store values in the file
jsonfile.writeFile('salary-types.json', salaryTypes, error => {
  if (error) {
    console.error(error);
  } else {
    console.log('Completed seeding SalaryTypes data!'.green);
  }
});

// generate incentives enum values to migrate
let incentives = [];
const incentiveValues = ['Car', 'Cell Phone', 'Signing Bonus'];
for (const value of incentiveValues) {
  incentives.push({
    id: faker.random.uuid(),
    value,
    status: true //faker.random.boolean()
  });
}

// store values in the file
jsonfile.writeFile('incentives.json', incentives, error => {
  if (error) {
    console.error(error);
  } else {
    console.log('Completed seeding incentives data!'.green);
  }
});

// generate benefits enum values to migrate
let benefits = [];
const benefitValues = ['401k', 'Medical', 'PTO', 'ESOP'];
for (const value of benefitValues) {
  benefits.push({
    id: faker.random.uuid(),
    value,
    status: true //faker.random.boolean()
  });
}

// store values in the file
jsonfile.writeFile('benefits.json', benefits, error => {
  if (error) {
    console.error(error);
  } else {
    console.log('Completed seeding Benefits data!'.green);
  }
});

// generate Requirements enum values to migrate
let requirements = [];
const requirementValues = ['Nights', 'Use your own vehicle', 'Relocate'];
for (const value of requirementValues) {
  requirements.push({
    id: faker.random.uuid(),
    value,
    status: true //faker.random.boolean()
  });
}

// store values in the file
jsonfile.writeFile('requirements.json', requirements, error => {
  if (error) {
    console.error(error);
  } else {
    console.log('Completed seeding Requirements data!'.green);
  }
});

// generate Current Status enum values to migrate
let currentStatuses = [];
const currentStatusValues = ['Employed', 'Unemployed', 'Internship'];
for (const value of currentStatusValues) {
  currentStatuses.push({
    id: faker.random.uuid(),
    value,
    status: true //faker.random.boolean()
  });
}

// store values in the file
jsonfile.writeFile('current-statuses.json', currentStatuses, error => {
  if (error) {
    console.error(error);
  } else {
    console.log('Completed seeding Current Status data!'.green);
  }
});

// generate Education enum values to migrate
let educations = [];
const educationValues = ['High school degree', "Associate's degree", 'Bachelors degree', "Master's degree", 'PHD degree', 'None'];
for (const value of educationValues) {
  educations.push({
    id: faker.random.uuid(),
    value,
    status: true //faker.random.boolean()
  });
}

// store values in the file
jsonfile.writeFile('educations.json', educations, error => {
  if (error) {
    console.error(error);
  } else {
    console.log('Completed seeding Educations data!'.green);
  }
});

// generate Resume enum values to migrate
let resumes = [];
const resumeValues = ['Sports fanatic', 'Veteran', 'Reserves', 'Family man', 'Golfer'];
for (const value of resumeValues) {
  resumes.push({
    id: faker.random.uuid(),
    value,
    status: true //faker.random.boolean()
  });
}

// store values in the file
jsonfile.writeFile('resumes.json', resumes, error => {
  if (error) {
    console.error(error);
  } else {
    console.log('Completed seeding Resumes data!'.green);
  }
});

// generate Title enum values to migrate
let titles = [];
const titleValues = ['Admin', 'HR / Talented Professional', 'Manager / Head of Department', 'Diretor / VP', 'Business Owner', 'C Level', 'Other'];
for (const value of titleValues) {
  titles.push({
    id: faker.random.uuid(),
    value,
    status: true //faker.random.boolean()
  });
}

// store values in the file
jsonfile.writeFile('titles.json', titles, error => {
  if (error) {
    console.error(error);
  } else {
    console.log('Completed seeding Titles data!'.green);
  }
});
